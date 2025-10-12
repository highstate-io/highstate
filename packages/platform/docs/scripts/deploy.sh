#!/usr/bin/env bash
set -e

IMAGE="ghcr.io/highstate-io/highstate/docs:latest"
NAMESPACE="docs"
DEPLOYMENT="docs"

# Get the latest image hash
IMAGE_HASH=$(docker images --format "{{.Repository}}:{{.Tag}} {{.Digest}}" | grep "^${IMAGE} " | awk '{print $2}')

# Pull the image if not found locally
if [ -z "$IMAGE_HASH" ]; then
  docker pull $IMAGE

  # Try to get the image hash again
  IMAGE_HASH=$(docker images --format "{{.Repository}}:{{.Tag}} {{.Digest}}" | grep "^${IMAGE} " | awk '{print $2}')
fi

if [ -z "$IMAGE_HASH" ]; then
  echo "No image found for ${IMAGE}. The image must be built and pushed before deployment."
  exit 1
fi

echo "[+] Found image hash: ${IMAGE_HASH}"

# Prepare kubectl command
if [ -z "$DOCS_KUBECONFIG" ]; then
  echo "DOCS_KUBECONFIG environment variable is not set. Cannot proceed with deployment."
  exit 1
fi

echo $DOCS_KUBECONFIG | base64 -d > /tmp/kubeconfig
export KUBECONFIG="/tmp/kubeconfig"
echo "[+] Using kubeconfig from DOCS_KUBECONFIG"

# Deploy the image to Kubernetes
echo "[+] Deploying image ${IMAGE}@${IMAGE_HASH} to deployment ${DEPLOYMENT} in namespace ${NAMESPACE}"
kubectl -n $NAMESPACE set image deployment/$DEPLOYMENT $DEPLOYMENT=$IMAGE@$IMAGE_HASH
