FROM ghcr.io/headlamp-k8s/headlamp:v0.45.0@sha256:db3f0e0fc58d358d41daa3fe7fc852437552c7ee873c3645470f7b86a8e0db49 AS headlamp

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS plugin-builder

WORKDIR /plugin
COPY packages/standard/k8s.dashboard-worker/plugin/package.json ./
COPY packages/standard/k8s.dashboard-worker/plugin/package-lock.json ./
COPY packages/standard/k8s.dashboard-worker/plugin/tsconfig.json ./
COPY packages/standard/k8s.dashboard-worker/plugin/src ./src
RUN npm ci && npm run build

FROM oven/bun:1.3.11-alpine AS builder

WORKDIR /app
COPY . .
COPY package.json ./
COPY bun.lock ./

RUN bun install --production --filter @highstate/k8s.dashboard-worker

FROM oven/bun:1.3.11-alpine

WORKDIR /app
COPY --from=headlamp /headlamp /headlamp
COPY --from=plugin-builder /plugin/dist /headlamp/plugins/highstate-dashboard
COPY --from=plugin-builder /plugin/package.json /headlamp/plugins/highstate-dashboard/package.json
COPY --from=builder /app/node_modules /app/node_modules

COPY --from=builder /app/packages/platform/contract/dist /app/packages/platform/contract/dist
COPY --from=builder /app/packages/platform/contract/package.json /app/packages/platform/contract/package.json
COPY --from=builder /app/packages/platform/contract/node_modules /app/packages/platform/contract/node_modules

COPY --from=builder /app/packages/platform/worker-sdk/dist /app/packages/platform/worker-sdk/dist
COPY --from=builder /app/packages/platform/worker-sdk/package.json /app/packages/platform/worker-sdk/package.json
COPY --from=builder /app/packages/platform/worker-sdk/node_modules /app/packages/platform/worker-sdk/node_modules

COPY --from=builder /app/packages/platform/api/dist /app/packages/platform/api/dist
COPY --from=builder /app/packages/platform/api/package.json /app/packages/platform/api/package.json
COPY --from=builder /app/packages/platform/api/node_modules /app/packages/platform/api/node_modules

COPY --from=builder /app/packages/standard/k8s.dashboard-worker/dist /app/packages/standard/k8s.dashboard-worker/dist
COPY --from=builder /app/packages/standard/k8s.dashboard-worker/package.json /app/packages/standard/k8s.dashboard-worker/package.json
COPY --from=builder /app/packages/standard/k8s.dashboard-worker/node_modules /app/packages/standard/k8s.dashboard-worker/node_modules

CMD ["bun", "packages/standard/k8s.dashboard-worker/dist/index.js"]
