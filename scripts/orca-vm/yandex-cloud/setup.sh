#!/usr/bin/env bash

set -euo pipefail

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_command yc
require_command jq
require_command ssh

action="${1:-}"
confirmation="${2:-}"
case "$action" in
  sync | base | auth-start | auth-finish | auth-migrate | cleanup) ;;
  *)
    printf 'Usage: %s sync|base|auth-start|auth-finish|auth-migrate|cleanup\n' "$0" >&2
    exit 1
    ;;
esac
[[ "$confirmation" == "--confirm-cloud-changes" ]] || {
  printf 'Refusing Yandex Cloud setup without informed confirmation\n' >&2
  printf 'After explaining cloud cost and authentication storage, rerun with --confirm-cloud-changes\n' >&2
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
disk_size="$(config_value YANDEX_DISK_SIZE diskSize 50G)"
disk_type="$(config_value YANDEX_DISK_TYPE diskType network-ssd)"
ssh_options=(-i "$identity_file" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)
repo_root="$(cd "$provider_dir/../../.." && pwd)"
instance_id=""
cleanup_instance_ids=()
cloud_init_file=""

[[ -f "$identity_file" ]] || { printf 'SSH identity "%s" does not exist\n' "$identity_file" >&2; exit 1; }
[[ -f "$public_key_file" ]] || { printf 'SSH public key "%s" does not exist\n' "$public_key_file" >&2; exit 1; }

cleanup_instance() {
  local exit_code=$?
  [[ -z "$cloud_init_file" ]] || rm -f "$cloud_init_file"
  if [[ $exit_code -ne 0 ]]; then
    for cleanup_instance_id in "${cleanup_instance_ids[@]}"; do
      yc compute instance delete "$cleanup_instance_id" --folder-id "$folder_id" --async >/dev/null 2>&1 || true
    done
  fi
  exit "$exit_code"
}
trap cleanup_instance EXIT
trap 'exit 130' INT TERM

cloud_init_file="$(mktemp)"
create_cloud_init "$ssh_username" "$public_key_file" "$cloud_init_file"

create_instance() {
  local name="$1"
  local image_id="$2"
  local source_disk="image-family=$image_family,image-folder-id=$image_folder_id"
  if [[ -n "$image_id" ]]; then
    source_disk="image-id=$image_id"
  fi

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
    --create-boot-disk "name=$name,type=$disk_type,size=$disk_size,$source_disk,auto-delete=true" \
    --metadata-from-file "user-data=$cloud_init_file" \
    --format json
}

create_image() {
  local source_instance_id="$1"
  local image_name="$2"
  local family="$3"
  local disk_id
  disk_id="$(yc compute instance get "$source_instance_id" --folder-id "$folder_id" --format json | jq -r '.boot_disk.disk_id')"
  yc compute instance stop "$source_instance_id" --folder-id "$folder_id" >/dev/null
  yc compute image create \
    --name "$image_name" \
    --folder-id "$folder_id" \
    --source-disk-id "$disk_id" \
    --family "$family" \
    --format json | jq -r '.id'
}

delete_obsolete_images() {
  local family="$1"
  local retained_id="$2"
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

build_base() {
  local name
  name="orca-highstate-base-$(date +%s)"
  local instance
  instance="$(create_instance "$name" "")"
  instance_id="$(jq -r '.id' <<<"$instance")"
  cleanup_instance_ids+=("$instance_id")
  local public_ip
  public_ip="$(wait_for_public_ip "$instance_id" "$folder_id")"
  wait_for_ssh "$public_ip" "$ssh_username" "$identity_file"

  printf 'Installing the shared workspace toolchain\n' >&2
  ssh "${ssh_options[@]}" "$ssh_username@$public_ip" 'bash -s' \
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

  local image_id
  image_id="$(create_image "$instance_id" "orca-highstate-base-$(date +%Y%m%d-%H%M%S)" orca-highstate-base)"
  yc compute instance delete "$instance_id" --folder-id "$folder_id" >/dev/null
  instance_id=""
  write_state "$(jq -n --arg id "$image_id" '{baseImageId: $id}')"
  delete_obsolete_images orca-highstate-base "$image_id"
}

start_auth() {
  local base_image_id
  base_image_id="$(required_value YANDEX_BASE_IMAGE_ID baseImageId)"
  local instance
  instance="$(create_instance "orca-highstate-auth-$(date +%s)" "$base_image_id")"
  instance_id="$(jq -r '.id' <<<"$instance")"
  cleanup_instance_ids+=("$instance_id")
  local public_ip
  public_ip="$(wait_for_public_ip "$instance_id" "$folder_id")"
  wait_for_ssh "$public_ip" "$ssh_username" "$identity_file"
  write_state "$(jq -n --arg id "$instance_id" '{authInstanceId: $id}')"
  instance_id=""

  printf 'Authenticate OpenCode, then run "%s auth-finish":\n' "$0" >&2
  printf 'ssh -t -i %q -o IdentitiesOnly=yes %q %q\n' \
    "$identity_file" "$ssh_username@$public_ip" \
    "mkdir -p \"\$HOME/.config/opencode\" && \$HOME/.opencode/bin/opencode auth login" >&2
}

finish_auth() {
  instance_id="$(required_value YANDEX_AUTH_INSTANCE_ID authInstanceId)"
  local public_ip
  public_ip="$(wait_for_public_ip "$instance_id" "$folder_id")"
  wait_for_ssh "$public_ip" "$ssh_username" "$identity_file"
  ssh "${ssh_options[@]}" "$ssh_username@$public_ip" \
    'test -s "$HOME/.local/share/opencode/auth.json" &&
      jq -e "type == \"object\" and length > 0" "$HOME/.local/share/opencode/auth.json" >/dev/null' || {
    printf 'OpenCode authentication is missing\n' >&2
    exit 1
  }

  local image_id
  image_id="$(create_image "$instance_id" "orca-highstate-auth-$(date +%Y%m%d-%H%M%S)" orca-highstate-auth)"
  yc compute instance delete "$instance_id" --folder-id "$folder_id" >/dev/null
  instance_id=""
  write_state "$(jq -n --arg id "$image_id" '{authenticatedImageId: $id, authInstanceId: null}')"
  delete_obsolete_images orca-highstate-auth "$image_id"
}

migrate_auth() {
  local source_image_id
  source_image_id="${1:-$(required_value YANDEX_AUTHENTICATED_IMAGE_ID authenticatedImageId)}"
  local base_image_id
  base_image_id="$(required_value YANDEX_BASE_IMAGE_ID baseImageId)"

  printf 'Starting previous authenticated image "%s"\n' "$source_image_id" >&2
  local source_instance
  source_instance="$(create_instance "orca-highstate-auth-source-$(date +%s)" "$source_image_id")"
  local source_instance_id
  source_instance_id="$(jq -r '.id' <<<"$source_instance")"
  cleanup_instance_ids+=("$source_instance_id")
  local source_ip
  source_ip="$(wait_for_public_ip "$source_instance_id" "$folder_id")"
  wait_for_ssh "$source_ip" "$ssh_username" "$identity_file"
  ssh "${ssh_options[@]}" "$ssh_username@$source_ip" \
    'auth_file="$(sudo find /home -path "*/.local/share/opencode/auth.json" -type f -print -quit)"
      test -n "$auth_file" && test -s "$auth_file" &&
      sudo jq -e "type == \"object\" and length > 0" "$auth_file" >/dev/null &&
      test -d "${auth_file%/.local/share/opencode/auth.json}/.config/opencode"' || {
    printf 'The authenticated image does not contain both OpenCode authentication and user configuration\n' >&2
    exit 1
  }

  printf 'Starting new base image "%s"\n' "$base_image_id" >&2
  local target_instance
  target_instance="$(create_instance "orca-highstate-auth-target-$(date +%s)" "$base_image_id")"
  instance_id="$(jq -r '.id' <<<"$target_instance")"
  cleanup_instance_ids+=("$instance_id")
  local target_ip
  target_ip="$(wait_for_public_ip "$instance_id" "$folder_id")"
  wait_for_ssh "$target_ip" "$ssh_username" "$identity_file"

  printf 'Copying OpenCode authentication and user configuration\n' >&2
  ssh "${ssh_options[@]}" "$ssh_username@$source_ip" \
    'auth_file="$(sudo find /home -path "*/.local/share/opencode/auth.json" -type f -print -quit)"
      source_home="${auth_file%/.local/share/opencode/auth.json}"
      sudo tar -C "$source_home" -cf - .local/share/opencode/auth.json .config/opencode' |
    ssh "${ssh_options[@]}" "$ssh_username@$target_ip" \
      'umask 077; tar -C "$HOME" -xf -; chmod 600 "$HOME/.local/share/opencode/auth.json"'

  ssh "${ssh_options[@]}" "$ssh_username@$target_ip" \
    'test -s "$HOME/.local/share/opencode/auth.json" &&
      jq -e "type == \"object\" and length > 0" "$HOME/.local/share/opencode/auth.json" >/dev/null &&
      test -d "$HOME/.config/opencode"'

  local image_id
  image_id="$(create_image "$instance_id" "orca-highstate-auth-$(date +%Y%m%d-%H%M%S)" orca-highstate-auth)"
  yc compute instance delete "$instance_id" --folder-id "$folder_id" >/dev/null
  instance_id=""
  yc compute instance delete "$source_instance_id" --folder-id "$folder_id" >/dev/null
  write_state "$(jq -n --arg id "$image_id" '{authenticatedImageId: $id, authInstanceId: null}')"
  delete_obsolete_images orca-highstate-auth "$image_id"
}

latest_ready_image() {
  local family="$1"
  yc compute image list --folder-id "$folder_id" --format json | jq -r --arg family "$family" \
    '[.[] | select(.family == $family and .status == "READY")] | sort_by(.created_at) | last | .id // empty'
}

cleanup_images() {
  local retained_base_image_id
  retained_base_image_id="$(config_value YANDEX_BASE_IMAGE_ID baseImageId)"
  local retained_auth_image_id
  retained_auth_image_id="$(config_value YANDEX_AUTHENTICATED_IMAGE_ID authenticatedImageId)"

  if [[ -n "$retained_base_image_id" ]]; then
    delete_obsolete_images orca-highstate-base "$retained_base_image_id"
  fi
  if [[ -n "$retained_auth_image_id" ]]; then
    delete_obsolete_images orca-highstate-auth "$retained_auth_image_id"
  fi
}

sync_images() {
  local source_auth_image_id
  source_auth_image_id="$(latest_ready_image orca-highstate-auth)"

  build_base

  if [[ -n "$source_auth_image_id" ]]; then
    printf 'Migrating OpenCode authentication from image "%s"\n' "$source_auth_image_id" >&2
    migrate_auth "$source_auth_image_id"
  else
    printf 'No authenticated image exists; starting interactive authentication\n' >&2
    start_auth
  fi

  cleanup_images
}

case "$action" in
  sync) sync_images ;;
  base) build_base ;;
  auth-start) start_auth ;;
  auth-finish) finish_auth ;;
  auth-migrate) migrate_auth ;;
  cleanup) cleanup_images ;;
esac

jq . "$state_file"
