#!/usr/bin/env bash

set -euo pipefail

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_command yc
require_command jq

payload="$(cat)"
instance_id="$(yandex_instance_id_from_payload "$payload")"
folder_id="$(required_value YANDEX_FOLDER_ID folderId)"
printf 'Deleting Yandex Cloud instance "%s"\n' "$instance_id" >&2
if output="$(yc compute instance delete "$instance_id" --folder-id "$folder_id" 2>&1)"; then
  exit 0
fi
if [[ "${output,,}" == *"not found"* ]]; then
  printf 'Yandex Cloud instance "%s" is already absent\n' "$instance_id" >&2
  exit 0
fi
printf '%s\n' "$output" >&2
exit 1
