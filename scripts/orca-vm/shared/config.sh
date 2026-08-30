#!/usr/bin/env bash

set -euo pipefail

shared_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
orca_vm_dir="$(cd "$shared_dir/.." && pwd)"
shared_config_file="${ORCA_VM_CONFIG_FILE:-$orca_vm_dir/config.json}"
shared_example_config_file="$orca_vm_dir/config.example.json"
base_contract_version=1

shared_config_error() {
  printf 'Invalid shared VM configuration in "%s": %s\n' "$shared_config_file" "$1" >&2
  exit 1
}

validate_shared_config() {
  [[ -f "$shared_config_file" ]] || {
    printf 'Create "%s" from "%s"\n' "$shared_config_file" "$shared_example_config_file" >&2
    exit 1
  }
  jq -e '
    type == "object" and
    ((keys - ["files", "skills", "opencode"]) | length == 0) and
    (.files | type == "array") and
    (all(.files[];
      type == "object" and
      ((keys - ["path", "mode"]) | length == 0) and
      (.path | type == "string" and test("^[A-Za-z0-9._/-]+$") and startswith("/") | not) and
      (.path | split("/") | all(. != "" and . != "." and . != "..")) and
      (.mode | type == "string" and test("^0[0-7]{3}$")))) and
    ((.skills == false) or (.skills == true) or
      (.skills | type == "array" and all(.[]; type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._-]*$")))) and
    (.opencode | type == "object") and
    ((.opencode | keys) - ["enabled", "providers", "mcp", "defaultPermission"] | length == 0) and
    (.opencode.enabled | type == "boolean") and
    ((.opencode.providers == true) or
      (.opencode.providers | type == "array" and all(.[]; type == "string" and length > 0))) and
    ((.opencode.mcp == false) or (.opencode.mcp == true) or
      (.opencode.mcp | type == "array" and all(.[]; type == "string" and length > 0))) and
    (.opencode.defaultPermission | type == "string" and
      (. == "" or . == "allow" or . == "ask" or . == "deny"))
  ' "$shared_config_file" >/dev/null || shared_config_error 'the document does not match config.example.json'

  local duplicate
  duplicate="$(jq -r '[.files[].path] | group_by(.)[] | select(length > 1) | first // empty' "$shared_config_file")"
  [[ -z "$duplicate" ]] || shared_config_error "duplicate file path: $duplicate"
  for selector in skills opencode.providers opencode.mcp; do
    duplicate="$(jq -r --arg selector "$selector" '
      (if $selector == "skills" then .skills
       elif $selector == "opencode.providers" then .opencode.providers
       else .opencode.mcp end) as $value |
      if ($value | type) == "array" then
        [$value[]] | group_by(.)[] | select(length > 1) | first // empty
      else empty end' "$shared_config_file")"
    [[ -z "$duplicate" ]] || shared_config_error "duplicate $selector entry: $duplicate"
  done

  while IFS=$'\t' read -r relative_path _; do
    local source_path="$HOME/$relative_path"
    [[ -f "$source_path" && ! -L "$source_path" ]] || \
      shared_config_error "file must be an existing regular non-symlink file: $relative_path"
  done < <(jq -r '.files[] | [.path, .mode] | @tsv' "$shared_config_file")

  validate_skills
  validate_opencode
}

opencode_enabled() {
  jq -r '.opencode.enabled' "$shared_config_file"
}

selected_names() {
  local expression="$1"
  jq -r "$expression | if type == \"array\" then .[] else empty end" "$shared_config_file"
}

validate_skills() {
  local skills_value
  skills_value="$(jq -r '.skills | type + ":" + tostring' "$shared_config_file")"
  if [[ "$skills_value" == "boolean:false" ]]; then
    return 0
  fi
  [[ -d "$HOME/.agents/skills" ]] || shared_config_error 'skills are enabled but ~/.agents/skills does not exist'
  if [[ "$skills_value" == "boolean:true" ]]; then
    return
  fi
  while IFS= read -r skill; do
    [[ -d "$HOME/.agents/skills/$skill" && ! -L "$HOME/.agents/skills/$skill" ]] || \
      shared_config_error "skill must be an existing non-symlink directory: $skill"
  done < <(selected_names '.skills')
}

resolved_opencode_config() {
  (cd /tmp && opencode --pure debug config)
}

validate_opencode() {
  if [[ "$(opencode_enabled)" != true ]]; then
    return 0
  fi
  command -v opencode >/dev/null 2>&1 || shared_config_error 'OpenCode is enabled but opencode is not installed locally'
  local auth_file="$HOME/.local/share/opencode/auth.json"
  [[ -s "$auth_file" ]] || shared_config_error 'OpenCode is enabled but ~/.local/share/opencode/auth.json is missing'
  jq -e 'type == "object" and length > 0' "$auth_file" >/dev/null || \
    shared_config_error 'OpenCode auth.json must be a non-empty object'

  while IFS= read -r provider; do
    jq -e --arg provider "$provider" 'has($provider)' "$auth_file" >/dev/null || \
      shared_config_error "OpenCode provider has no local credential: $provider"
  done < <(selected_names '.opencode.providers')

  local mcp_selection
  mcp_selection="$(jq -r '.opencode.mcp | type + ":" + tostring' "$shared_config_file")"
  if [[ "$mcp_selection" != "array:"* ]]; then
    return 0
  fi
  local resolved
  resolved="$(resolved_opencode_config)" || shared_config_error 'OpenCode configuration could not be resolved'
  while IFS= read -r mcp; do
    jq -e --arg mcp "$mcp" '.mcp | type == "object" and has($mcp)' <<<"$resolved" >/dev/null || \
      shared_config_error "OpenCode MCP is not present in the resolved configuration: $mcp"
  done < <(selected_names '.opencode.mcp')
}

base_contract_hash() {
  local enabled
  enabled="$(opencode_enabled)"
  {
    printf 'contract=%s\nopencode=%s\n' "$base_contract_version" "$enabled"
    sha256sum "$shared_dir/setup-base.sh"
  } | sha256sum | cut -c1-32
}

ssh_target() {
  local host="$1"
  local username="$2"
  printf '%s@%s' "$username" "$host"
}

copy_configured_files() {
  local host="$1"
  local username="$2"
  local identity_file="$3"
  local target
  target="$(ssh_target "$host" "$username")"
  local ssh_options=(-i "$identity_file" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)

  while IFS=$'\t' read -r relative_path mode; do
    local parent
    parent="$(dirname "$relative_path")"
    # shellcheck disable=SC2029
    ssh -n "${ssh_options[@]}" "$target" "mkdir -p -- \"\$HOME/$parent\" && chmod 0700 -- \"\$HOME/$parent\"" >&2
    # shellcheck disable=SC2029
    ssh "${ssh_options[@]}" "$target" "umask 077; cat >\"\$HOME/$relative_path\" && chmod $mode -- \"\$HOME/$relative_path\"" \
      <"$HOME/$relative_path" >&2
  done < <(jq -r '.files[] | [.path, .mode] | @tsv' "$shared_config_file")
}

copy_skills() {
  local host="$1"
  local username="$2"
  local identity_file="$3"
  local skills_type
  skills_type="$(jq -r '.skills | type' "$shared_config_file")"
  if [[ "$(jq -r '.skills' "$shared_config_file")" == false ]]; then
    return 0
  fi
  local target
  target="$(ssh_target "$host" "$username")"
  local ssh_options=(-i "$identity_file" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)
  local skills=()
  if [[ "$skills_type" == "boolean" ]]; then
    while IFS= read -r skill_path; do skills+=("$(basename "$skill_path")"); done \
      < <(printf '%s\n' "$HOME"/.agents/skills/*)
  else
    while IFS= read -r skill; do skills+=("$skill"); done < <(selected_names '.skills')
  fi
  if [[ ${#skills[@]} -eq 0 ]]; then
    return 0
  fi
  tar -C "$HOME/.agents/skills" -cf - "${skills[@]}" |
    ssh "${ssh_options[@]}" "$target" \
      'set -euo pipefail; mkdir -p "$HOME/.agents/skills"; chmod 0700 "$HOME/.agents" "$HOME/.agents/skills"; tar -C "$HOME/.agents/skills" -xf -' >&2
}

filtered_opencode_config() {
  local resolved="$1"
  local providers mcps permission
  providers="$(jq -c '.opencode.providers' "$shared_config_file")"
  mcps="$(jq -c '.opencode.mcp' "$shared_config_file")"
  permission="$(jq -r '.opencode.defaultPermission' "$shared_config_file")"
  jq --argjson providers "$providers" --argjson mcps "$mcps" --arg permission "$permission" '
    del(.plugin_origins) |
    if ($providers | type) == "array" then
      .provider = ((.provider // {}) | with_entries(select(.key as $key | $providers | index($key)))) |
      .enabled_providers = $providers |
      if (.model? and ((.model | split("/")[0]) as $key | $providers | index($key) | not)) then del(.model) else . end |
      if (.small_model? and ((.small_model | split("/")[0]) as $key | $providers | index($key) | not)) then del(.small_model) else . end
    else . end |
    if $mcps == false then del(.mcp)
    elif ($mcps | type) == "array" then
      .mcp = ((.mcp // {}) | with_entries(select(.key as $key | $mcps | index($key))))
    else . end |
    if $permission == "" then . else .permission = $permission end
  ' <<<"$resolved"
}

copy_opencode() {
  local host="$1"
  local username="$2"
  local identity_file="$3"
  if [[ "$(opencode_enabled)" != true ]]; then
    return 0
  fi
  local target
  target="$(ssh_target "$host" "$username")"
  local ssh_options=(-i "$identity_file" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)
  local providers mcps resolved filtered auth_file mcp_auth_file
  providers="$(jq -c '.opencode.providers' "$shared_config_file")"
  mcps="$(jq -c '.opencode.mcp' "$shared_config_file")"
  resolved="$(resolved_opencode_config)"
  filtered="$(filtered_opencode_config "$resolved")"
  auth_file="$HOME/.local/share/opencode/auth.json"
  mcp_auth_file="$HOME/.local/share/opencode/mcp-auth.json"

  if [[ -d "$HOME/.config/opencode" ]]; then
    tar -C "$HOME/.config/opencode" --exclude=node_modules --exclude=package.json --exclude=package-lock.json \
      --exclude=bun.lock --exclude=.gitignore --exclude=opencode.json --exclude=opencode.jsonc -cf - . |
      ssh "${ssh_options[@]}" "$target" \
        'set -euo pipefail; mkdir -p "$HOME/.config/opencode"; chmod 0700 "$HOME/.config/opencode"; tar -C "$HOME/.config/opencode" -xf -' >&2
  fi
  printf '%s\n' "$filtered" | ssh "${ssh_options[@]}" "$target" \
    'umask 077; mkdir -p "$HOME/.config/opencode"; cat >"$HOME/.config/opencode/opencode.json"; chmod 0600 "$HOME/.config/opencode/opencode.json"' >&2
  jq --argjson providers "$providers" \
    'if ($providers | type) == "array" then with_entries(select(.key as $key | $providers | index($key))) else . end' \
    "$auth_file" | ssh "${ssh_options[@]}" "$target" \
      'umask 077; mkdir -p "$HOME/.local/share/opencode"; cat >"$HOME/.local/share/opencode/auth.json"; chmod 0600 "$HOME/.local/share/opencode/auth.json"' >&2

  if [[ "$mcps" != false && -s "$mcp_auth_file" ]]; then
    jq --argjson mcps "$mcps" \
      'if ($mcps | type) == "array" then with_entries(select(.key as $key | $mcps | index($key))) else . end' \
      "$mcp_auth_file" | ssh "${ssh_options[@]}" "$target" \
        'umask 077; cat >"$HOME/.local/share/opencode/mcp-auth.json"; chmod 0600 "$HOME/.local/share/opencode/mcp-auth.json"' >&2
  fi
}

copy_workspace_credentials() {
  copy_configured_files "$@"
  copy_skills "$@"
  copy_opencode "$@"
}
