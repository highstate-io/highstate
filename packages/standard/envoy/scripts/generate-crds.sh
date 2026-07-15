#!/usr/bin/env bash
source ../../../scripts/shared.sh

curl -L https://github.com/envoyproxy/gateway/releases/download/v1.8.1/install.yaml \
  -o envoy-gateway-install.yaml

yq eval-all '
  select(.kind == "CustomResourceDefinition" and .spec.group == "gateway.envoyproxy.io")
' envoy-gateway-install.yaml > envoy-gateway-crds.yaml

generate_crds envoy-gateway-crds envoy-gateway-crds.yaml

rm envoy-gateway-install.yaml
rm envoy-gateway-crds.yaml
