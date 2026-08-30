#!/usr/bin/env bash

set -euo pipefail

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_command yc
require_command jq
require_command ssh
validate_shared_config

action="${1:-}"
confirmation="${2:-}"
case "$action" in
  sync | base | cleanup) ;;
  *)
    printf 'Usage: %s sync|base|cleanup --confirm-cloud-changes\n' "$0" >&2
    exit 1
    ;;
esac
[[ "$confirmation" == "--confirm-cloud-changes" ]] || {
  printf 'Refusing Yandex Cloud setup without informed confirmation\n' >&2
  printf 'After explaining cloud cost, rerun with --confirm-cloud-changes\n' >&2
  exit 1
}

folder_id="$(required_value YANDEX_FOLDER_ID folderId)"
zone="$(required_value YANDEX_ZONE zone)"
subnet_id="$(required_value YANDEX_SUBNET_ID subnetId)"
identity_file="$(expanded_path "$(required_value YANDEX_SSH_IDENTITY_FILE sshIdentityFile)")"
public_key_file="$(expanded_path "$(required_value YANDEX_SSH_PUBLIC_KEY_FILE sshPublicKeyFile)")"
ssh_username="$(config_value YANDEX_SSH_USERNAME sshUsername dev)"
image_family="$(config_value YANDEX_SOURCE_IMAGE_FAMILY sourceImageFamily ubuntu-2404-lts)"
image_folder_id="$(config_value YANDEX_SOURCE_IMAGE_FOLDER_ID sourceImageFolderId standard-images)"
platform="$(config_value YANDEX_PLATFORM platform standard-v3)"
cores="$(config_value YANDEX_CORES cores 4)"
memory="$(config_value YANDEX_MEMORY memory 8G)"
core_fraction="$(config_value YANDEX_CORE_FRACTION coreFraction 100)"
disk_size="$(config_value YANDEX_DISK_SIZE diskSize 93G)"
disk_type="$(config_value YANDEX_DISK_TYPE diskType network-ssd-nonreplicated)"
ssh_options=(-i "$identity_file" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)
repo_root="$(cd "$provider_dir/../../.." && pwd)"
instance_id=""
cloud_init_file=""

[[ -f "$identity_file" ]] || { printf 'SSH identity "%s" does not exist\n' "$identity_file" >&2; exit 1; }
[[ -f "$public_key_file" ]] || { printf 'SSH public key "%s" does not exist\n' "$public_key_file" >&2; exit 1; }

cleanup_instance() {
  local exit_code=$?
  [[ -z "$cloud_init_file" ]] || rm -f "$cloud_init_file"
  if [[ $exit_code -ne 0 && -n "$instance_id" ]]; then
    yc compute instance delete "$instance_id" --folder-id "$folder_id" --async >/dev/null 2>&1 || true
  fi
  exit "$exit_code"
}
trap cleanup_instance EXIT
trap 'exit 130' INT TERM

cloud_init_file="$(mktemp)"
create_cloud_init "$ssh_username" "$public_key_file" "$cloud_init_file"

create_instance() {
  local name="$1"
  yc compute instance create \
    --name "$name" \
    --folder-id "$folder_id" \
    --zone "$zone" \
    --platform "$platform" \
    --cores "$cores" \
    --memory "$memory" \
    --core-fraction "$core_fraction" \
    --preemptible \
    --network-interface "subnet-id=$subnet_id,nat-ip-version=ipv4" \
    --create-boot-disk "name=$name,type=$disk_type,size=$disk_size,image-family=$image_family,image-folder-id=$image_folder_id,auto-delete=true" \
    --metadata-from-file "user-data=$cloud_init_file" \
    --format json
}

delete_images() {
  local family="$1"
  local retained_id="${2:-}"
  local image_ids
  image_ids="$(yc compute image list --folder-id "$folder_id" --format json | jq -r \
    --arg family "$family" --arg retained "$retained_id" \
    '.[] | select(.family == $family and .id != $retained) | .id')"
  while IFS= read -r image_id; do
    [[ -n "$image_id" ]] || continue
    printf 'Deleting obsolete image "%s"\n' "$image_id" >&2
    yc compute image delete "$image_id" --folder-id "$folder_id" >/dev/null
  done <<<"$image_ids"
}

sanitize_state() {
  if [[ ! -f "$state_file" ]]; then
    return 0
  fi
  jq 'del(.authenticatedImageId, .authInstanceId)' "$state_file" >"$state_file.tmp"
  mv "$state_file.tmp" "$state_file"
}

build_base() {
  local name
  name="orca-highstate-base-$(date +%s)"
  local instance
  instance="$(create_instance "$name")"
  instance_id="$(jq -r '.id' <<<"$instance")"
  local public_ip
  public_ip="$(wait_for_public_ip "$instance_id" "$folder_id")"
  wait_for_ssh "$public_ip" "$ssh_username" "$identity_file"

  printf 'Installing the shared workspace toolchain\n' >&2
  local remote_environment
  remote_environment="$(printf 'OPENCODE_ENABLED=%q' "$(opencode_enabled)")"
  # shellcheck disable=SC2029
  ssh "${ssh_options[@]}" "$ssh_username@$public_ip" "$remote_environment bash -s" \
    <"$provider_dir/../shared/setup-base.sh"

  printf 'Warming the repository devenv\n' >&2
  tar -C "$repo_root" -cf - devenv.nix devenv.yaml devenv.lock |
    ssh "${ssh_options[@]}" "$ssh_username@$public_ip" \
      'set -euo pipefail
      warmup_dir="$HOME/.cache/highstate-devenv"
      rm -rf "$warmup_dir"
      mkdir -p "$warmup_dir"
      tar -C "$warmup_dir" -xf -
      cd "$warmup_dir"
      devenv shell -- true'

  local disk_id image_id contract_hash
  disk_id="$(yc compute instance get "$instance_id" --folder-id "$folder_id" --format json | jq -r '.boot_disk.disk_id')"
  contract_hash="$(base_contract_hash)"
  yc compute instance stop "$instance_id" --folder-id "$folder_id" >/dev/null
  image_id="$(yc compute image create \
    --name "orca-highstate-base-$(date +%Y%m%d-%H%M%S)" \
    --folder-id "$folder_id" \
    --source-disk-id "$disk_id" \
    --family orca-highstate-base \
    --labels "orca_base_contract=${base_contract_version:?},orca_base_hash=$contract_hash" \
    --format json | jq -r '.id')"
  yc compute instance delete "$instance_id" --folder-id "$folder_id" >/dev/null
  instance_id=""
  sanitize_state
  write_state "$(jq -n --arg id "$image_id" '{baseImageId: $id}')"
  delete_images orca-highstate-base "$image_id"
}

cleanup_images() {
  sanitize_state
  local retained_base_image_id
  retained_base_image_id="$(config_value YANDEX_BASE_IMAGE_ID baseImageId)"
  delete_images orca-highstate-base "$retained_base_image_id"
  delete_images orca-highstate-auth
}

case "$action" in
  sync) build_base; cleanup_images ;;
  base) build_base ;;
  cleanup) cleanup_images ;;
esac

jq . "$state_file"
