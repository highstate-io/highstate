#!/usr/bin/env bash
set -euo pipefail

# Check for at least one argument: the images JSON file.
if [ "$#" -lt 1 ]; then
    echo "Usage: $0 <images-file> [--missing]"
    exit 1
fi

IMAGES_FILE="$1"
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

# Determine which image keys to process.
if [ "$MISSING_FLAG" = true ]; then
    image_keys=$(jq -r '
        to_entries
        | map(select((.value.image // "") == ""))
        | .[].key
    ' "$IMAGES_FILE")
else
    image_keys=$(jq -r 'keys[]' "$IMAGES_FILE")
fi

for key in $image_keys; do
    name=$(jq -r --arg key "$key" '.[$key].name' "$IMAGES_FILE")
    tag=$(jq -r --arg key "$key" '.[$key].tag' "$IMAGES_FILE")

    # Validate and format the image reference.
    if [[ -z "$name" || -z "$tag" ]]; then
        echo "Invalid image reference for $key: name or tag is empty"
        continue
    fi

    image_ref="$name:$tag"

    echo "Processing image: $key ($image_ref)"

    # Fetch the manifest list and extract the digest.
    digest=$(docker buildx imagetools inspect "$image_ref" --raw | sha256sum | head -c 64)

    image="$name:$tag@sha256:$digest"
    echo "Updated $key: image=$image"

    # Update the JSON file for this image.
    tmp_json=$(mktemp)
    jq --arg key "$key" --arg image "$image" \
       '.[$key].image = $image' \
       "$IMAGES_FILE" > "$tmp_json" && mv "$tmp_json" "$IMAGES_FILE"
done
