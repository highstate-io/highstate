#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
provider="${1:-}"
action="${2:-}"

[[ "$provider" =~ ^[a-z0-9][a-z0-9-]*$ ]] || {
  printf 'Provider must contain only lowercase letters, numbers, and hyphens\n' >&2
  exit 1
}
case "$action" in
  create | suspend | resume | destroy) ;;
  *)
    printf 'Action must be create, suspend, resume, or destroy\n' >&2
    exit 1
    ;;
esac

provider_script="$script_dir/$provider/$action.sh"
[[ -x "$provider_script" ]] || {
  printf 'Provider action is not executable: %s\n' "$provider_script" >&2
  exit 1
}

log_dir="$script_dir/logs"
log_file="$log_dir/$provider.$action.log"
mkdir -p "$log_dir"
chmod 700 "$log_dir"
: >"$log_file"
chmod 600 "$log_file"

exec > >(tee -a "$log_file") 2> >(tee -a "$log_file" >&2)
printf '[%s] %s %s (pid %s)\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$provider" "$action" "$$" >&2
exec "$provider_script"
