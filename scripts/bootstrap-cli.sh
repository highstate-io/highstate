#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

cli_version="v0.19.1"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

cli_package_spec="npm:@highstate/cli@${cli_version}"

cat >"$tmp_dir/package.json" <<EOF
{
  "name": "highstate-bootstrap-workspace",
  "private": true,
  "dependencies": {
    "@highstate/cli": "$cli_package_spec"
  },
  "devDependencies": {
    "typescript": "^5.9.3"
  }
}
EOF

echo "Installing bootstrap CLI from $cli_package_spec"
bun install --cwd "$tmp_dir" --silent

cli_entry="$tmp_dir/node_modules/@highstate/cli/dist/main.js"
if [[ ! -f "$cli_entry" ]]; then
  echo "Bootstrap CLI entry not found at $cli_entry" >&2
  exit 1
fi

bootstrap_packages=(
  "packages/platform/contract"
  "packages/platform/backend"
  "packages/platform/cli"
)

for package_path in "${bootstrap_packages[@]}"; do
  echo "Bootstrapping build in $package_path"
  (
    cd "$repo_root/$package_path"
    bun "$cli_entry" build
  )
done
