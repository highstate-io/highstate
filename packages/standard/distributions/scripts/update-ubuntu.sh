#!/usr/bin/env bash
set -euo pipefail

# Check for at least one argument: the ubuntu JSON file.
if [ "$#" -lt 1 ]; then
    echo "Usage: $0 <ubuntu-file> [--missing]"
    exit 1
fi

UBUNTU_FILE="$1"
MISSING_FLAG=false

# Handle optional flags.
shift
while [ $# -gt 0 ]; do
    case "$1" in
        --missing)
            MISSING_FLAG=true
            ;;
    esac
    shift
done

# Map Ubuntu versions to codenames
declare -A VERSION_TO_CODENAME
VERSION_TO_CODENAME["22.04"]="jammy"
VERSION_TO_CODENAME["24.04"]="noble"
# VERSION_TO_CODENAME["24.10"]="oracular"
VERSION_TO_CODENAME["25.04"]="plucky"
VERSION_TO_CODENAME["25.10"]="questing"

# Supported architectures
ARCHITECTURES=("amd64" "arm64")

# Determine which Ubuntu versions to process.
if [ "$MISSING_FLAG" = true ]; then
    # Process only versions that are missing data
    ubuntu_versions=$(jq -r '
        to_entries
        | map(select(
            (.value.amd64.sha256 // "") == "" or
            (.value.arm64.sha256 // "") == ""
        ))
        | .[].key
    ' "$UBUNTU_FILE")
else
    # Process all supported Ubuntu versions
    ubuntu_versions=$(printf '%s\n' "${!VERSION_TO_CODENAME[@]}")
fi

for version in $ubuntu_versions; do
    codename="${VERSION_TO_CODENAME[$version]:-}"
    
    if [[ -z "$codename" ]]; then
        echo "Unknown Ubuntu version: $version"
        continue
    fi
    
    echo "Processing Ubuntu $version ($codename)..."
    
    # Find the latest available date directory
    echo "  Finding latest release date..."
    directory_listing=$(curl -s "https://cloud-images.ubuntu.com/$codename/" || {
        echo "  Failed to fetch directory listing for $version ($codename)"
        continue
    })
    
    # Check if the response contains "Not Found" (404 error)
    if echo "$directory_listing" | grep -q "Not Found"; then
        echo "  Directory not found for $version ($codename) - skipping"
        continue
    fi
    
    latest_date=$(echo "$directory_listing" | \
        grep -oE '[0-9]{8}/' | \
        sed 's/\///' | \
        sort -r | \
        head -n1)
    
    if [[ -z "$latest_date" ]]; then
        echo "  Failed to find latest date for $version ($codename)"
        continue
    fi
    
    echo "  Latest date: $latest_date"
    
    # Fetch SHA256SUMS file from the dated directory
    sha256_url="https://cloud-images.ubuntu.com/$codename/$latest_date/SHA256SUMS"
    sha256_data=$(curl -s "$sha256_url" || {
        echo "Failed to fetch SHA256SUMS for $version ($codename) from $latest_date"
        continue
    })
    
    # Process each architecture
    for arch in "${ARCHITECTURES[@]}"; do
        filename="$codename-server-cloudimg-$arch.img"
        image_url="https://cloud-images.ubuntu.com/$codename/$latest_date/$filename"
        
        # Extract SHA256 hash for this file
        sha256_hash=$(echo "$sha256_data" | grep " \*\?$filename$" | awk '{print $1}' || echo "")
        
        if [[ -z "$sha256_hash" ]]; then
            echo "Warning: No SHA256 hash found for $filename"
            continue
        fi
        
        echo "  $arch: $image_url (sha256: $sha256_hash)"
        
        # Update the JSON file for this version and architecture
        tmp_json=$(mktemp)
        jq --arg version "$version" \
           --arg arch "$arch" \
           --arg url "$image_url" \
           --arg sha256 "$sha256_hash" \
           '
           .[$version] = (.[$version] // {}) |
           .[$version][$arch] = {
               "url": $url,
               "sha256": $sha256
           }
           ' \
           "$UBUNTU_FILE" > "$tmp_json" && mv "$tmp_json" "$UBUNTU_FILE"
    done
done

echo "Ubuntu image information updated successfully."
