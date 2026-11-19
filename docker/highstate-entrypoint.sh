#!/bin/sh
set -eu

# Never remove or replace this inode: runtime and offline backup share its lock.
mkdir -p /data
exec 9>>/data/.highstate-owner.lock
if ! flock --exclusive --nonblock 9; then
  printf '%s\n' 'Highstate data is already owned by another runtime or offline backup' >&2
  exit 73
fi

# Bind-mount sources must have identical absolute paths in Highstate and dockerd.
mkdir -p /data/workspace /data/home /data/pulumi /data/cache /run/user/0
mkdir -p /data/home/.pulumi
ln -sfn /opt/pulumi/bin /data/home/.pulumi/bin
export HOME=/data/home
export PULUMI_HOME=/data/pulumi
export HIGHSTATE_CODEBASE_PATH=/data/workspace
export HIGHSTATE_RUNNER_BACKEND_LOCAL_CACHE_DIR=/data/cache
if [ ! -f /data/workspace/package.json ]; then
  printf '%s\n' '{"name":"highstate-workspace","private":true,"workspaces":[]}' > /data/workspace/package.json
fi
# pkg-types discovers workspace roots through a lockfile, even for an empty workspace.
if [ ! -f /data/workspace/bun.lock ]; then
  printf '%s\n' '{"lockfileVersion":1,"workspaces":{"":{"name":"highstate-workspace"}}}' > /data/workspace/bun.lock
fi
ln -sfn /opt/highstate/node_modules /data/workspace/node_modules
cd /data/workspace
: "${HIGHSTATE_AUTH_PROVIDERS_FILE:?}"
HIGHSTATE_AUTH_ADMIN_USER_IDS="$(bun /opt/highstate/docker/highstate-admins.ts userIds)"
HIGHSTATE_AUTH_ADMIN_GROUP_IDS="$(bun /opt/highstate/docker/highstate-admins.ts groupIds)"
export HIGHSTATE_AUTH_ADMIN_USER_IDS HIGHSTATE_AUTH_ADMIN_GROUP_IDS

# Pulumi state and login metadata belong to this runtime, never a caller's cloud account.
mkdir -p /data/pulumi-state
pulumi login file:///data/pulumi-state

attempt=0
until docker info >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge "${HIGHSTATE_DOCKER_START_ATTEMPTS:-120}" ]; then
    printf '%s\n' 'Docker did not become ready' >&2
    exit 1
  fi
  sleep 1
done

# The daemon belongs exclusively to this runtime. An application-only restart can
# leave workers, terminals, or unit sidecars alive after their owner has exited.
containers="$(docker ps --all --quiet)"
if [ -n "$containers" ]; then
  printf '%s\n' "$containers" | xargs docker rm --force >/dev/null
fi

# tini forwards termination signals to Nitro's process group before the native sidecar stops.
exec bun /opt/highstate/packages/platform/designer/.output/server/index.mjs
