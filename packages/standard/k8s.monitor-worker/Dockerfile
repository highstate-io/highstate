# 1. at build stage, we just resolve all external dependencies and create up-to-date node_modules
FROM node:24-alpine AS builder

WORKDIR /app
COPY . .
COPY package.json ./
COPY yarn.lock ./

RUN corepack enable
RUN yarn workspaces focus @highstate/k8s.monitor-worker --production

# 2. at run stage, we copy only the node_modules and the built code for the app and local dependencies
FROM node:24-alpine

WORKDIR /app
COPY --from=builder /app/node_modules /app/node_modules

COPY --from=builder /app/packages/platform/contract/dist /app/packages/platform/contract/dist
COPY --from=builder /app/packages/platform/contract/package.json /app/packages/platform/contract/package.json

COPY --from=builder /app/packages/standard/library/dist /app/packages/standard/library/dist
COPY --from=builder /app/packages/standard/library/package.json /app/packages/standard/library/package.json

COPY --from=builder /app/packages/platform/worker-sdk/dist /app/packages/platform/worker-sdk/dist
COPY --from=builder /app/packages/platform/worker-sdk/package.json /app/packages/platform/worker-sdk

COPY  --from=builder /app/packages/platform/api/dist /app/packages/platform/api/dist
COPY --from=builder /app/packages/platform/api/package.json /app/packages/platform/api/package.json

COPY --from=builder /app/packages/standard/k8s.monitor-worker/dist /app/packages/standard/k8s.monitor-worker/dist
COPY --from=builder /app/packages/standard/k8s.monitor-worker/package.json /app/packages/standard/k8s.monitor-worker/package.json

CMD ["node", "packages/standard/k8s.monitor-worker/dist/index.js"]
