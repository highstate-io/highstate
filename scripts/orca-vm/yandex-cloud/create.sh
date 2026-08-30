#!/usr/bin/env bash

set -euo pipefail

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_command yc
require_command jq
require_command ssh

[[ "${ORCA_RECIPE_RESULT_SCHEMA_VERSION:-}" == "2" ]] || {
  printf 'Yandex Cloud requires checkoutMode "provisioned-root" and schema version 2\n' >&2
  exit 1
}

folder_id="$(required_value YANDEX_FOLDER_ID folderId)"
zone="$(required_value YANDEX_ZONE zone)"
subnet_id="$(required_value YANDEX_SUBNET_ID subnetId)"
image_id="$(required_value YANDEX_AUTHENTICATED_IMAGE_ID authenticatedImageId)"
identity_file="$(expanded_path "$(required_value YANDEX_SSH_IDENTITY_FILE sshIdentityFile)")"
public_key_file="$(expanded_path "$(required_value YANDEX_SSH_PUBLIC_KEY_FILE sshPublicKeyFile)")"
ssh_username="$(config_value YANDEX_SSH_USERNAME sshUsername dev)"
project_root="$(config_value YANDEX_PROJECT_ROOT projectRoot /home/dev/workspace)"
platform="$(config_value YANDEX_PLATFORM platform standard-v3)"
cores="$(config_value YANDEX_CORES cores 4)"
memory="$(config_value YANDEX_MEMORY memory 8G)"
core_fraction="$(config_value YANDEX_CORE_FRACTION coreFraction 100)"
disk_size="$(config_value YANDEX_DISK_SIZE diskSize 50G)"
disk_type="$(config_value YANDEX_DISK_TYPE diskType network-ssd)"
opencode_permission="$(config_value YANDEX_OPENCODE_PERMISSION opencodePermission)"
case "$opencode_permission" in
  "" | allow | ask | deny) ;;
  *)
    printf 'OpenCode permission must be "allow", "ask", or "deny"\n' >&2
    exit 1
    ;;
esac
repo_url="${ORCA_REPO_URL:?ORCA_REPO_URL is required}"
if [[ "$repo_url" =~ ^git@github\.com:(.+)$ ]]; then
  repo_url="https://github.com/${BASH_REMATCH[1]}"
fi
repo_ref="${ORCA_REPO_REF:?ORCA_REPO_REF is required}"
repo_ref_head="${ORCA_REPO_REF_HEAD:?ORCA_REPO_REF_HEAD is required}"
repo_branch="${ORCA_REPO_BRANCH:?ORCA_REPO_BRANCH is required}"
workspace_name="${ORCA_WORKSPACE_NAME:-${ORCA_RECIPE_ID:-workspace}}"
workspace_slug="$(printf '%s' "$workspace_name" | tr -cs '[:alnum:]-' '-' | tr '[:upper:]' '[:lower:]')"
workspace_slug="${workspace_slug#-}"
workspace_slug="${workspace_slug%-}"
workspace_slug="${workspace_slug:-workspace}"
workspace_slug="${workspace_slug:0:58}"
workspace_slug="${workspace_slug%-}"
name="orca-$workspace_slug"
instance_id=""
public_ip=""
cloud_init_file=""

[[ -f "$identity_file" ]] || { printf 'SSH identity "%s" does not exist\n' "$identity_file" >&2; exit 1; }
[[ -f "$public_key_file" ]] || { printf 'SSH public key "%s" does not exist\n' "$public_key_file" >&2; exit 1; }

cleanup() {
  local exit_code=$?
  [[ -z "$cloud_init_file" ]] || rm -f "$cloud_init_file"
  if [[ $exit_code -ne 0 && -n "$instance_id" ]]; then
    printf 'Deleting failed Yandex Cloud instance "%s"\n' "$instance_id" >&2
    yc compute instance delete "$instance_id" --folder-id "$folder_id" >/dev/null 2>&1 || true
  fi
  trap - EXIT INT TERM
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

cloud_init_file="$(mktemp)"
create_cloud_init "$ssh_username" "$public_key_file" "$cloud_init_file"

printf 'Creating Yandex Cloud instance "%s"\n' "$name" >&2
instance="$(yc compute instance create \
  --name "$name" \
  --folder-id "$folder_id" \
  --zone "$zone" \
  --platform "$platform" \
  --cores "$cores" \
  --memory "$memory" \
  --core-fraction "$core_fraction" \
  --preemptible \
  --network-interface "subnet-id=$subnet_id,nat-ip-version=ipv4" \
  --create-boot-disk "name=$name,type=$disk_type,size=$disk_size,image-id=$image_id,auto-delete=true" \
  --metadata-from-file "user-data=$cloud_init_file" \
  --labels "managed-by=orca,orca-recipe=yandex-cloud" \
  --format json)"
instance_id="$(jq -r '.id' <<<"$instance")"
public_ip="$(wait_for_public_ip "$instance_id" "$folder_id")"
wait_for_ssh "$public_ip" "$ssh_username" "$identity_file"

remote_environment="$(printf \
  'PROJECT_ROOT=%q REPO_URL=%q REPO_REF=%q REPO_REF_HEAD=%q REPO_BRANCH=%q OPENCODE_PERMISSION=%q' \
  "$project_root" "$repo_url" "$repo_ref" "$repo_ref_head" "$repo_branch" "$opencode_permission")"
# shellcheck disable=SC2029
ssh -i "$identity_file" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
  "$ssh_username@$public_ip" "$remote_environment bash -s" \
  <"$provider_dir/../shared/setup-workspace.sh" >&2

recipe_result="$(ssh_recipe_result "$instance_id" yandex-cloud "Yandex Cloud workspace" \
  "$public_ip" "$ssh_username" "$identity_file" "$project_root")"
jq -e 'type == "object"' >/dev/null <<<"$recipe_result"
printf '%s\n' "$recipe_result"
rm -f "$cloud_init_file"
cloud_init_file=""
trap - EXIT
