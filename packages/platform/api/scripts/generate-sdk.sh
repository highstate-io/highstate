#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

PROTOCOL_DIR="$PROJECT_DIR/protocol"
OUTPUT_DIR="$PROJECT_DIR/src/_generated"

mkdir -p "$OUTPUT_DIR"
rm -rf "$OUTPUT_DIR"/*

PROTO_FILES=$(find "$PROTOCOL_DIR" -name "*.proto" -type f)

protoc \
    --plugin=../../../node_modules/.bin/protoc-gen-ts_proto \
    --ts_proto_out="$OUTPUT_DIR" \
    --ts_proto_opt=outputServices=nice-grpc \
    --ts_proto_opt=outputServices=generic-definitions \
    --ts_proto_opt=useExactTypes=false \
    --ts_proto_opt=esModuleInterop=true \
    --ts_proto_opt=forceLong=string \
    --ts_proto_opt=useOptionals=messages \
    --ts_proto_opt=oneof=unions-value \
    --proto_path="$PROTOCOL_DIR" \
    $PROTO_FILES
