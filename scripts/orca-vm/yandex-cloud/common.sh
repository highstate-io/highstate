#!/usr/bin/env bash

set -euo pipefail

provider_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export ORCA_ENVIRONMENT_PROVIDER_DIR="$provider_dir"

# shellcheck source=../shared/common.sh
source "$provider_dir/../shared/common.sh"

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
