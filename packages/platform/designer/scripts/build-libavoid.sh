#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/boxabirds/libavoid-rust.git"
REPO_REVISION="f72fe0b6a541b8f32a1c160d38c889f0c697eecd"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
TARGET_DIR="$SCRIPT_DIR/../layers/core/app/workers/libavoid"
PUBLIC_WASM_PATH="$SCRIPT_DIR/../public/libavoid.wasm"
PATCH_DIR="$SCRIPT_DIR/libavoid-rust-patches"

if ! command -v git >/dev/null 2>&1; then
  echo "error: git is required but not found in PATH" >&2
  exit 1
fi

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "error: wasm-pack is required but not found in PATH" >&2
  echo "hint: install Rust + wasm-pack (devenv should provide it)" >&2
  exit 1
fi

ensure_cargo_toolchain() {
  if command -v cargo >/dev/null 2>&1 && cargo --version >/dev/null 2>&1; then
    return
  fi

  if ! command -v rustup >/dev/null 2>&1; then
    echo "error: cargo is unavailable and rustup is not installed" >&2
    echo "hint: install Rust toolchain (devenv should provide it)" >&2
    exit 1
  fi

  echo "[build-libavoid] configuring rustup stable toolchain"
  rustup toolchain install stable --profile minimal
  rustup default stable

  if ! command -v cargo >/dev/null 2>&1 || ! cargo --version >/dev/null 2>&1; then
    echo "error: cargo is still unavailable after rustup setup" >&2
    exit 1
  fi
}

ensure_cargo_toolchain

TEMP_DIR="$(mktemp -d -t libavoid-rust-XXXXXX)"
cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo "[build-libavoid] cloning $REPO_URL"
git clone "$REPO_URL" "$TEMP_DIR/repo"

echo "[build-libavoid] checking out revision $REPO_REVISION"
cd "$TEMP_DIR/repo"
git checkout "$REPO_REVISION"

if compgen -G "$PATCH_DIR/*.patch" >/dev/null; then
  echo "[build-libavoid] applying local patches from $PATCH_DIR"

  for patch in "$PATCH_DIR"/*.patch; do
    echo "[build-libavoid] applying $(basename "$patch")"
    git apply "$patch"
  done
fi

echo "[build-libavoid] building wasm package"

build_with_custom_output() {
  wasm-pack build \
    --release \
    --target web \
    --features wasm \
    --out-dir "$TEMP_DIR/out" \
    --out-name libavoid
}

build_with_default_output() {
  wasm-pack build \
    --release \
    --target web \
    --features wasm

  rm -rf "$TEMP_DIR/out"
  mkdir -p "$TEMP_DIR/out"
  cp -f ./pkg/* "$TEMP_DIR/out"/
}

if ! build_with_custom_output; then
  echo "[build-libavoid] custom output flags are unsupported, retrying with default output" >&2
  build_with_default_output
fi

echo "[build-libavoid] copying bindings to $TARGET_DIR"
mkdir -p "$TARGET_DIR"

# Remove stale wasm in case previous runs copied it into bindings directory.
rm -f "$TARGET_DIR/libavoid_bg.wasm"

# Keep bindings and metadata next to worker code, but exclude wasm binary.
find "$TEMP_DIR/out" -maxdepth 1 -type f ! -name "libavoid_bg.wasm" -exec cp -f {} "$TARGET_DIR"/ \;

echo "[build-libavoid] syncing wasm to static assets"
mkdir -p "$(dirname "$PUBLIC_WASM_PATH")"
cp -f "$TEMP_DIR/out/libavoid_bg.wasm" "$PUBLIC_WASM_PATH"

# Keep wasm only in public to avoid duplicate copies and enforce one runtime source.
rm -f "$TARGET_DIR/libavoid_bg.wasm"

echo "[build-libavoid] done"
