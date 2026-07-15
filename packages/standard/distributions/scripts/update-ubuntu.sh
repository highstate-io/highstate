#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
    echo "Usage: $0 <artifacts-file> [--missing]"
    exit 1
fi

ARTIFACTS_FILE="$1"
shift

ARGS=("$@")

declare -A VERSION_TO_CODENAME
VERSION_TO_CODENAME["22.04"]="jammy"
VERSION_TO_CODENAME["24.04"]="noble"
VERSION_TO_CODENAME["25.04"]="plucky"
VERSION_TO_CODENAME["25.10"]="questing"

group_count=$(jq '.ubuntu.params.groups | length' "$ARTIFACTS_FILE")

for ((index = 0; index < group_count; index++)); do
    version=$(jq -r --argjson index "$index" '.ubuntu.params.groups[$index].version' "$ARTIFACTS_FILE")
    codename="${VERSION_TO_CODENAME[$version]:-}"

    if [[ -z "$codename" ]]; then
        echo "Unknown Ubuntu version: $version" >&2
        exit 1
    fi

    echo "Processing Ubuntu $version ($codename)..."

    listing=$(curl -fsSL "https://cloud-images.ubuntu.com/releases/$codename/")
    release=$(printf '%s\n' "$listing" | grep -oE 'release-[0-9]{8}/' | sed 's/release-//; s#/##' | sort -r | head -n1)

    if [[ -z "$release" ]]; then
        echo "Failed to find latest release for Ubuntu $version ($codename)" >&2
        exit 1
    fi

    echo "  Latest release: $release"

    tmp_json=$(mktemp)
    jq \
        --argjson index "$index" \
        --arg version "$version" \
        --arg codename "$codename" \
        --arg release "$release" \
        '.ubuntu.params.groups[$index].version = $version
          | .ubuntu.params.groups[$index].codename = $codename
          | .ubuntu.params.groups[$index].release = $release
          | .ubuntu.sha256 = {}' \
        "$ARTIFACTS_FILE" > "$tmp_json" && mv "$tmp_json" "$ARTIFACTS_FILE"
done

bun ../../../scripts/update-artifacts.ts "$ARTIFACTS_FILE" "${ARGS[@]}"
