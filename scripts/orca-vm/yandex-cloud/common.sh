#!/usr/bin/env bash

set -euo pipefail

provider_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export ORCA_ENVIRONMENT_PROVIDER_DIR="$provider_dir"

# shellcheck source=../shared/common.sh
source "$provider_dir/../shared/common.sh"
# shellcheck source=../shared/config.sh
source "$provider_dir/../shared/config.sh"

validate_base_image() {
  local image_id="$1"
  local folder_id="$2"
  local expected_hash
  expected_hash="$(base_contract_hash)"
  local image
  image="$(yc compute image get "$image_id" --folder-id "$folder_id" --format json)" || {
    printf 'Yandex Cloud base image "%s" was not found\n' "$image_id" >&2
    exit 1
  }
  jq -e --arg hash "$expected_hash" --arg contract "$base_contract_version" '
    .status == "READY" and .family == "orca-highstate-base" and
    .labels.orca_base_contract == $contract and .labels.orca_base_hash == $hash
  ' <<<"$image" >/dev/null || {
    printf 'Base image "%s" does not match the configured harnesses or setup scripts\n' "$image_id" >&2
    printf 'Rebuild it with: bash scripts/orca-vm/yandex-cloud/setup.sh sync --confirm-cloud-changes\n' >&2
    exit 1
  }
}

yandex_instance_id_from_payload() {
  local payload="$1"
  local resource_id
  resource_id="$(jq -r '.recipeResult.userData.resourceId // .userData.resourceId // empty' <<<"$payload")"
  if [[ -n "$resource_id" ]]; then
    printf '%s' "$resource_id"
    return
  fi

  local workspace_name
  workspace_name="$(jq -r '.workspaceName // empty' <<<"$payload")"
  if [[ -z "$workspace_name" ]]; then
    printf 'Lifecycle payload contains neither a provider resource id nor a workspace name\n' >&2
    exit 1
  fi

  local workspace_slug
  workspace_slug="$(printf '%s' "$workspace_name" | tr -cs '[:alnum:]-' '-' | tr '[:upper:]' '[:lower:]')"
  workspace_slug="${workspace_slug#-}"
  workspace_slug="${workspace_slug%-}"
  workspace_slug="${workspace_slug:-workspace}"
  workspace_slug="${workspace_slug:0:58}"
  workspace_slug="${workspace_slug%-}"

  local folder_id
  folder_id="$(required_value YANDEX_FOLDER_ID folderId)"
  resource_id="$(yc compute instance get "orca-$workspace_slug" --folder-id "$folder_id" --format json | jq -r '.id // empty')"
  if [[ -z "$resource_id" ]]; then
    printf 'Yandex Cloud instance for workspace "%s" was not found\n' "$workspace_name" >&2
    exit 1
  fi
  printf '%s' "$resource_id"
}

create_cloud_init() {
  local username="$1"
  local public_key_file="$2"
  local output_file="$3"

  [[ "$username" =~ ^[a-z_][a-z0-9_-]*$ ]] || {
    printf 'SSH username "%s" is not a valid Linux username\n' "$username" >&2
    return 1
  }
  local public_key
  public_key="$(<"$public_key_file")"
  {
    printf '#cloud-config\n'
    jq -n --arg username "$username" --arg publicKey "$public_key" \
      '{users: [{name: $username, groups: ["sudo"], sudo: "ALL=(ALL) NOPASSWD:ALL", shell: "/bin/bash", ssh_authorized_keys: [$publicKey]}], ssh_pwauth: false}'
  } >"$output_file"
}

wait_for_public_ip() {
  local instance_id="$1"
  local folder_id="$2"

  for _ in {1..90}; do
    local instance
    instance="$(yc compute instance get "$instance_id" --folder-id "$folder_id" --format json)"
    local status
    status="$(jq -r '.status // empty' <<<"$instance")"
    local public_ip
    public_ip="$(jq -r '.network_interfaces[0].primary_v4_address.one_to_one_nat.address // empty' <<<"$instance")"
    if [[ "$status" == "RUNNING" && -n "$public_ip" ]]; then
      printf '%s' "$public_ip"
      return
    fi
    sleep 2
  done

  printf 'Instance "%s" did not obtain a public IP address\n' "$instance_id" >&2
  exit 1
}
