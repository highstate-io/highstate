#!/usr/bin/env bash
source ../../scripts/shared.sh

# local-path-provisioner
kubectl kustomize ./kustomize/local-path-provisioner > ./assets/local-path-provisioner.yaml
