#!/usr/bin/env bash
source ../../../scripts/shared.sh

# gateway-api
generate_crds gateway-api https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.3.0/experimental-install.yaml

# cert-manager
pull_chart ./assets/charts.json cert-manager
helm template --set crds.enabled=true cert-manager cert-manager.tgz > cert-manager.yaml

generate_crds cert-manager cert-manager.yaml

rm cert-manager.yaml
rm cert-manager.tgz
