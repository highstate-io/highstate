#!/usr/bin/env bash

set -euo pipefail

# Desktop applications on NixOS do not always inherit user and system profile paths.
export PATH="$HOME/.nix-profile/bin:/run/current-system/sw/bin:$PATH"

provider_dir="${ORCA_ENVIRONMENT_PROVIDER_DIR:?ORCA_ENVIRONMENT_PROVIDER_DIR is required}"
config_file="${ORCA_ENVIRONMENT_CONFIG_FILE:-$provider_dir/config.json}"
state_file="${ORCA_ENVIRONMENT_STATE_FILE:-$provider_dir/state.json}"
example_config_file="$provider_dir/config.example.json"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Required command "%s" was not found\n' "$1" >&2
    exit 1
  }
}

config_value() {
  local environment_name="$1"
  local key="$2"
  local fallback="${3:-}"
  local environment_value="${!environment_name:-}"

  if [[ -n "$environment_value" ]]; then
    printf '%s' "$environment_value"
    return
  fi

  if [[ -f "$state_file" ]]; then
    local state_value
    state_value="$(jq -r --arg key "$key" '.[$key] // empty' "$state_file")"
    if [[ -n "$state_value" ]]; then
      printf '%s' "$state_value"
      return
    fi
  fi

  if [[ -f "$config_file" ]]; then
    local configured_value
    configured_value="$(jq -r --arg key "$key" '.[$key] // empty' "$config_file")"
    if [[ -n "$configured_value" ]]; then
      printf '%s' "$configured_value"
      return
    fi
  fi

  printf '%s' "$fallback"
}

required_value() {
  local value
  value="$(config_value "$1" "$2")"
  if [[ -z "$value" ]]; then
    printf 'Set "%s" in "%s" or export "%s"; use "%s" as a template\n' \
      "$2" "$config_file" "$1" "$example_config_file" >&2
    exit 1
  fi
  printf '%s' "$value"
}

expanded_path() {
  local path="$1"
  printf '%s' "${path/#\~/$HOME}"
}

write_state() {
  local update="$1"
  local current='{}'
  if [[ -f "$state_file" ]]; then
    current="$(<"$state_file")"
  fi

  mkdir -p "$(dirname "$state_file")"
  jq -n --argjson current "$current" --argjson update "$update" '$current * $update' >"$state_file.tmp"
  mv "$state_file.tmp" "$state_file"
}

resource_id_from_payload() {
  local payload="$1"
  local resource_id
  resource_id="$(jq -r '.recipeResult.userData.resourceId // empty' <<<"$payload")"
  if [[ -z "$resource_id" ]]; then
    printf 'Lifecycle payload does not contain a provider resource id\n' >&2
    exit 1
  fi
  printf '%s' "$resource_id"
}

wait_for_ssh() {
  local host="$1"
  local username="$2"
  local identity_file="$3"

  # Public IPs are reused across disposable VMs, so a prior VM's key is not authoritative here.
  ssh-keygen -R "$host" >/dev/null 2>&1 || true
  ssh-keygen -R "[$host]:22" >/dev/null 2>&1 || true

  for _ in {1..60}; do
    if ssh -i "$identity_file" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
      -o ConnectTimeout=5 "$username@$host" true >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done

  printf 'SSH did not become ready at "%s"\n' "$host" >&2
  exit 1
}

ssh_recipe_result() {
  local resource_id="$1"
  local provider_name="$2"
  local label="$3"
  local host="$4"
  local username="$5"
  local identity_file="$6"
  local project_root="$7"

  jq -n --arg resourceId "$resource_id" --arg provider "$provider_name" --arg label "$label" \
    --arg host "$host" --arg username "$username" --arg identity "$identity_file" \
    --arg root "$project_root" \
    '{
      schemaVersion: 2,
      checkoutMode: "provisioned-root",
      connection: {
        type: "ssh",
        projectRoot: $root,
        target: {
          label: $label,
          host: $host,
          port: 22,
          username: $username,
          identityFile: $identity,
          identitiesOnly: true,
          relayGracePeriodSeconds: 0,
          portForwards: []
        }
      },
      userData: {provider: $provider, resourceId: $resourceId}
    }'
}
