#!/usr/bin/env bash

set -euo pipefail

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_command yc
require_command jq
require_command ssh

payload="$(</dev/stdin)"
instance_id="$(resource_id_from_payload "$payload")"
folder_id="$(required_value YANDEX_FOLDER_ID folderId)"
identity_file="$(expanded_path "$(required_value YANDEX_SSH_IDENTITY_FILE sshIdentityFile)")"
ssh_username="$(config_value YANDEX_SSH_USERNAME sshUsername dev)"
project_root="$(config_value YANDEX_PROJECT_ROOT projectRoot /home/dev/workspace)"

printf 'Starting Yandex Cloud instance "%s"\n' "$instance_id" >&2
yc compute instance start "$instance_id" --folder-id "$folder_id" >/dev/null
public_ip="$(wait_for_public_ip "$instance_id" "$folder_id")"
wait_for_ssh "$public_ip" "$ssh_username" "$identity_file"
ssh_recipe_result "$instance_id" yandex-cloud "Yandex Cloud workspace" \
  "$public_ip" "$ssh_username" "$identity_file" "$project_root"
