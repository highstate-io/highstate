#!/usr/bin/env bash

set -euo pipefail

: "${PROJECT_ROOT:?PROJECT_ROOT is required}"
: "${REPO_URL:?REPO_URL is required}"
: "${REPO_REF:?REPO_REF is required}"
: "${REPO_REF_HEAD:?REPO_REF_HEAD is required}"
: "${REPO_BRANCH:?REPO_BRANCH is required}"
: "${OPENCODE_ENABLED:?OPENCODE_ENABLED is required}"

rm -rf "$PROJECT_ROOT"
git clone --no-checkout "$REPO_URL" "$PROJECT_ROOT"
cd "$PROJECT_ROOT"
git fetch origin "$REPO_REF"
git cat-file -e "${REPO_REF_HEAD}^{commit}"
git checkout -B "$REPO_BRANCH" "$REPO_REF_HEAD"
git submodule update --init --recursive

for executable in bun devenv git jq nix node skills; do
  executable_path="/nix/var/nix/profiles/orca/bin/$executable"
  if [[ ! -x "$executable_path" ]]; then
    printf 'Base image is missing required executable: %s\n' "$executable_path" >&2
    printf 'Rebuild the Yandex Cloud base image with setup.sh sync before creating a workspace.\n' >&2
    exit 1
  fi
done
if [[ "$OPENCODE_ENABLED" == true && ! -x "$HOME/.opencode/bin/opencode" ]]; then
  printf 'Base image is missing OpenCode: %s/.opencode/bin/opencode\n' "$HOME" >&2
  printf 'Rebuild the Yandex Cloud base image with setup.sh sync before creating a workspace.\n' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1 && ! sudo docker info >/dev/null 2>&1; then
  printf 'Docker is not available in the base image\n' >&2
  printf 'Rebuild the Yandex Cloud base image with setup.sh sync before creating a workspace.\n' >&2
  exit 1
fi

devenv allow
devenv shell -- bash -euo pipefail -c '
  bun install --frozen-lockfile
  bun run ci:prepare
  bun run dev:build
'
