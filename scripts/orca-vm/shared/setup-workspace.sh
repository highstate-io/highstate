#!/usr/bin/env bash

set -euo pipefail

: "${PROJECT_ROOT:?PROJECT_ROOT is required}"
: "${REPO_URL:?REPO_URL is required}"
: "${REPO_REF:?REPO_REF is required}"
: "${REPO_REF_HEAD:?REPO_REF_HEAD is required}"
: "${REPO_BRANCH:?REPO_BRANCH is required}"

rm -rf "$PROJECT_ROOT"
git clone --no-checkout "$REPO_URL" "$PROJECT_ROOT"
cd "$PROJECT_ROOT"
git fetch origin "$REPO_REF"
git cat-file -e "${REPO_REF_HEAD}^{commit}"
git checkout -B "$REPO_BRANCH" "$REPO_REF_HEAD"
git submodule update --init --recursive

if [[ -n "${OPENCODE_PERMISSION:-}" ]]; then
  opencode_config="$HOME/.config/opencode/opencode.json"
  mkdir -p "$(dirname "$opencode_config")"
  current_config='{}'
  if [[ -f "$opencode_config" ]]; then
    current_config="$(<"$opencode_config")"
  fi
  jq --arg permission "$OPENCODE_PERMISSION" \
    '.["$schema"] //= "https://opencode.ai/config.json" | .permission = $permission' \
    <<<"$current_config" >"$opencode_config.tmp"
  mv "$opencode_config.tmp" "$opencode_config"
fi

for executable in bun devenv git jq nix node skills; do
  test -x "/nix/var/nix/profiles/orca/bin/$executable"
done
test -x "$HOME/.opencode/bin/opencode"
docker info >/dev/null
