#!/usr/bin/env bash

set -euo pipefail

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_command yc
require_command jq

payload="$(</dev/stdin)"
instance_id="$(resource_id_from_payload "$payload")"
folder_id="$(required_value YANDEX_FOLDER_ID folderId)"
printf 'Stopping Yandex Cloud instance "%s"\n' "$instance_id" >&2
yc compute instance stop "$instance_id" --folder-id "$folder_id" >/dev/null
