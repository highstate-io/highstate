# syntax=docker/dockerfile:1
FROM node:22.16.0-bookworm-slim AS node
FROM docker:28.2.2-cli AS docker-cli
FROM oven/bun:1.3.13-debian AS build
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git python3 make g++ libsecret-1-dev pkg-config && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/highstate
COPY . .
RUN bun install --frozen-lockfile
RUN bash scripts/bootstrap-cli.sh
# The first install skips the workspace bin because dist/main.js does not exist yet.
RUN ln -sf /opt/highstate/packages/platform/cli/dist/main.js /usr/local/bin/highstate \
    && ln -sf ../../packages/platform/cli/dist/main.js node_modules/.bin/highstate
RUN bunx --bun nx run-many -t build --projects=tag:stdlib
RUN bunx --bun nx run @highstate/designer:build

FROM build AS runtime
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
ARG PULUMI_VERSION=3.232.0
ARG KUBECTL_VERSION=v1.33.1
ARG TARGETARCH
ARG POSTGRESQL_CLIENT_VERSION=18
# pg_dump must be at least as new as the metadata server; do not use Bookworm's v15 default.
RUN apt-get update && apt-get install -y --no-install-recommends restic rclone util-linux mount tini libsecret-1-0 openssh-client openssl gnupg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg \
    && . /etc/os-release \
    && printf '%s\n' "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/postgresql.list \
    && apt-get update && apt-get install -y --no-install-recommends "postgresql-client-${POSTGRESQL_CLIENT_VERSION}" \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://get.pulumi.com | sh -s -- --version "$PULUMI_VERSION" --install-root /opt/pulumi
RUN arch="${TARGETARCH:-$(dpkg --print-architecture)}" && curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${arch}/kubectl" -o /usr/local/bin/kubectl && chmod +x /usr/local/bin/kubectl
RUN bun --version && node --version && pulumi_bin=/opt/pulumi/bin/pulumi && "$pulumi_bin" version \
    && docker --version && kubectl version --client && restic version && rclone version && pg_dump --version \
    && unshare --version && mount --version && test -s packages/platform/designer/.output/server/index.mjs
ENV PATH="/opt/pulumi/bin:${PATH}" \
    NODE_ENV=production \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000 \
    DOCKER_HOST=unix:///run/highstate-docker/docker.sock
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "sh", "/opt/highstate/docker/highstate-entrypoint.sh"]
EXPOSE 3000
