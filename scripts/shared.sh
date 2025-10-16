set -euo pipefail

_post_process_generated_package() {
    local package="$1"
    local version=$(node -p "require('./package.json').version")

    jq " \
        .name = \"@highstate/$package\" | \
        .version = \"$version\" | \
        .dependencies.typescript = \"^5.7.2\" | \
        .dependencies.\"@pulumi/pulumi\" = \"^3.198.0\" | \
        .publishConfig = {\"access\": \"public\"} | \
        .repository = {\"url\": \"https://github.com/highstate-io/highstate\"} | \
        .scripts.build = \"tsc && cp package.json bin/package.json\" | \
        del(.scripts.postinstall) \
    " generated/$package/package.json > generated/$package/package.json.tmp
    mv generated/$package/package.json.tmp generated/$package/package.json

    jq ".compilerOptions.noCheck = true" generated/$package/tsconfig.json > generated/$package/tsconfig.json.tmp
    mv generated/$package/tsconfig.json.tmp generated/$package/tsconfig.json

    # Remove scripts directory
    rm -rf "generated/$package/scripts"

    echo "[+] Post-processing generated package $package"
}

# Generates CRDs for a given package.
#
# package: The package name.
# source: The source file containing the CRD definitions.
generate_crds() {
    local package="$1"
    local source="$2"

    echo "[+] Generating CRDs for $1"

    rm -rf generated/$package
    crd2pulumi --nodejsPath generated/$package $source

    _post_process_generated_package $package
}

# Generates Terraform Bridge SDKs for a given Terraform provider/module.
#
# kind: The kind of the package: "provider" or "module".
# package: The package name.
# source: The full url to the Terraform provider/module.
generate_terraform_sdks() {
    local kind="$1"
    local package="$2"
    local source="$3"
    local version=$(node -p "require('./package.json').version")
    local sdkPath="./sdks"

    echo "[+] Generating Terraform Bridge SDKs for $package ($kind)"

    mkdir -p generated
    rm -rf generated/$package   

    if [ "$kind" = "provider" ]; then
        pulumi package add terraform-provider $source || echo "[!] That's fine, ignore this error"
    elif [ "$kind" = "module" ]; then
        pulumi package add terraform-module $source $package || echo "[!] That's fine, ignore this error"
    else
        echo "Unknown kind: $kind. Use 'provider' or 'module'."
        return 1
    fi

    # Move the SDK to the generated directory
    located_sdk_path=$sdkPath/$(ls $sdkPath)
    mv "$located_sdk_path" "generated/$package"
    rm -rf "$sdkPath"

    _post_process_generated_package $package
}

# Pulls a Helm chart from a repository according to the charts.json file.
# The file is stored in the working directory as "<chart_name>.tgz".
# It should be removed after the chart is processed.
# 
# charts_file: The JSON file containing the chart definitions.
# chart_name: The name of the chart to pull.
pull_chart() {
    local charts_file="$1"
    local chart_name="$2"

    if [ ! -f "$charts_file" ]; then
        echo "File $charts_file does not exist."
        return 1
    fi

    if [ -z "$chart_name" ]; then
        echo "Chart name is required."
        return 1
    fi

    local repo=$(jq -r --arg key "$chart_name" '.[$key].repo' "$charts_file")
    local name=$(jq -r --arg key "$chart_name" '.[$key].name' "$charts_file")
    local version=$(jq -r --arg key "$chart_name" '.[$key].version' "$charts_file")
    local sha256=$(jq -r --arg key "$chart_name" '.[$key].sha256' "$charts_file")

    echo "[+] Pulling chart: $chart_name ($repo/$name)"

    # Create a temporary directory for pulling the chart.
    local tmp_dir=$(mktemp -d)

    # Pull the chart using the exact version.
    helm pull "$name" --version "$version" --destination "$tmp_dir" --repo "$repo"

    # Find the downloaded .tgz file.
    local tgz_file=$(find "$tmp_dir" -maxdepth 1 -name "*.tgz" | head -n 1)

    if [ -z "$tgz_file" ]; then
        echo "Failed to pull chart for $chart_name"
        rm -rf "$tmp_dir"
        return 1
    fi

    # Verify the chart sha256 checksum.
    local actual_sha256=$(sha256sum "$tgz_file" | awk '{print $1}')

    if [ "$sha256" != "$actual_sha256" ]; then
        echo "Checksum mismatch for $chart_name: expected=$sha256, actual=$actual_sha256"
        rm -rf "$tmp_dir"
        return 1
    fi

    # Move the chart to the working directory.
    mv "$tgz_file" "$chart_name.tgz"
}
