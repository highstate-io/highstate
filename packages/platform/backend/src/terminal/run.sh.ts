export const runScript = `set -e -o pipefail
read -r data

# Extract env and files as key-value pairs, and command as an array
envKeys=($(jq -r '.env | keys[]' <<<"$data"))
filesKeys=($(jq -r '.files | keys[]' <<<"$data"))
commandArr=($(jq -r '.command[]' <<<"$data"))
cols=$(jq -r '.screenSize.cols' <<<"$data")
rows=$(jq -r '.screenSize.rows' <<<"$data")

# Set environment variables
for key in "\${envKeys[@]}"; do
  value=$(jq -r ".env[\\"$key\\"]" <<<"$data")
  export "$key=$value"
done

# Create files
for key in "\${filesKeys[@]}"; do
  contentType=$(jq -r ".files[\\"$key\\"].content.type" <<<"$data")
  
  # Skip artifact type files for now
  if [ "$contentType" = "artifact" ]; then
    continue
  fi
  
  # Handle embedded content
  if [ "$contentType" = "embedded" ]; then
    content=$(jq -r ".files[\\"$key\\"].content.value" <<<"$data")
    isBinary=$(jq -r ".files[\\"$key\\"].meta.isBinary // false" <<<"$data")
    mode=$(jq -r ".files[\\"$key\\"].meta.mode // 0" <<<"$data")
    
    mkdir -p "$(dirname "$key")"

    if [ "$isBinary" = "true" ]; then
      echo "$content" | base64 -d > "$key"
    else
      echo "$content" > "$key"
    fi

    if [ "$mode" -ne 0 ]; then
      chmod $(printf "%o" "$mode") "$key"
    fi
  fi
done

# Execute the command, keeping stdin/stdout open and spawnin a new TTY
cmd=$(printf "%q " "\${commandArr[@]}")
exec script -q -c "stty cols $cols rows $rows; $cmd" /dev/null
`
