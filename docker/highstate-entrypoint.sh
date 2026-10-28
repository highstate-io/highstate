#!/bin/sh
set -eu

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
HIGHSTATE_AUTH_ADMIN_USER_IDS="$(bun -e 'const c = await Bun.file(process.env.HIGHSTATE_AUTH_INITIAL_ADMINS_PATH).json(); if (!Array.isArray(c.userIds)) throw new Error("Missing userIds"); console.log(JSON.stringify(c.userIds))')"
HIGHSTATE_AUTH_ADMIN_GROUP_IDS="$(bun -e 'const c = await Bun.file(process.env.HIGHSTATE_AUTH_INITIAL_ADMINS_PATH).json(); if (!Array.isArray(c.groupIds)) throw new Error("Missing groupIds"); console.log(JSON.stringify(c.groupIds))')"
export HIGHSTATE_AUTH_ADMIN_USER_IDS HIGHSTATE_AUTH_ADMIN_GROUP_IDS

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
