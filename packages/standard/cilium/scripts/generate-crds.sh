#!/usr/bin/env bash
source ../../../scripts/shared.sh

# cilium
kubectl get crd -o json | jq '
  .items[] | select(.spec.group == "cilium.io" and ( 
    .metadata.name == "ciliumnetworkpolicies.cilium.io" or
    .metadata.name == "ciliumclusterwidenetworkpolicies.cilium.io"
  )
)' > cilium.json

generate_crds cilium-crds cilium.json
rm cilium.json
