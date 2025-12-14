#!/usr/bin/env bash
set -euo pipefail

# Check for at least one argument: the charts JSON file.
if [ "$#" -lt 1 ]; then
    echo "Usage: $0 <charts-file> [--latest] [--missing]"
    exit 1
fi

CHARTS_FILE="$1"
LATEST_FLAG=false
MISSING_FLAG=false

# Handle optional flags.
shift
while [ $# -gt 0 ]; do
    case "$1" in
        --latest)
            LATEST_FLAG=true
            ;;
        --missing)
            MISSING_FLAG=true
            ;;
    esac
    shift
done

# Determine which chart keys to process.
if [ "$MISSING_FLAG" = true ]; then
    chart_keys=$(jq -r '
        to_entries
        | map(select((.value.version // "") == "" or (.value.sha256 // "") == ""))
        | .[].key
    ' "$CHARTS_FILE")
else
    chart_keys=$(jq -r 'keys[]' "$CHARTS_FILE")
fi

for key in $chart_keys; do
    repo=$(jq -r --arg key "$key" '.[$key].repo' "$CHARTS_FILE")
    name=$(jq -r --arg key "$key" '.[$key].name' "$CHARTS_FILE")
    version=$(jq -r --arg key "$key" '.[$key].version' "$CHARTS_FILE")
    
    echo "Processing chart: $key ($repo/$name)"

    # Create a temporary directory for pulling the chart.
    tmp_dir=$(mktemp -d)

    if [[ "$repo" == oci://* ]]; then
        chart_ref="${repo%/}/$name"

        if [ "$LATEST_FLAG" = true ]; then
            helm pull "$chart_ref" --destination "$tmp_dir"
        else
            helm pull "$chart_ref" --version "$version" --destination "$tmp_dir"
        fi
    else
        if [ "$LATEST_FLAG" = true ]; then
            # Pull the chart without specifying version.
            helm pull "$name" --destination "$tmp_dir" --repo "$repo"
        else
            # Pull the chart using the exact version.
            helm pull "$name" --version "$version" --destination "$tmp_dir" --repo "$repo"
        fi
    fi

    tgz_file=$(find "$tmp_dir" -maxdepth 1 -name "*.tgz" | head -n 1)
    if [ -z "$tgz_file" ]; then
        echo "Failed to pull chart for $key"
        rm -rf "$tmp_dir"
        continue
    fi

    if [ "$LATEST_FLAG" = true ]; then
        # Extract version from the filename.
        # Assumes filename format: name-version.tgz
        base=$(basename "$tgz_file")
        new_version="${base%.tgz}"
        new_version="${new_version#$name-}"
        version="$new_version"
    fi

    # Calculate the SHA256 checksum of the chart tarball.
    sha256=$(sha256sum "$tgz_file" | awk '{print $1}')
    echo "Updated $key: version=$version, sha256=$sha256"

    # Update the JSON file for this chart.
    tmp_json=$(mktemp)
    jq --arg key "$key" --arg version "$version" --arg sha256 "$sha256" \
       '.[$key].version = $version | .[$key].sha256 = $sha256' \
       "$CHARTS_FILE" > "$tmp_json" && mv "$tmp_json" "$CHARTS_FILE"

    # Clean up the temporary directory.
    rm -rf "$tmp_dir"
done
