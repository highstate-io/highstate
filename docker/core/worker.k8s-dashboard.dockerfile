FROM ghcr.io/headlamp-k8s/headlamp:v0.45.0@sha256:db3f0e0fc58d358d41daa3fe7fc852437552c7ee873c3645470f7b86a8e0db49 AS headlamp

FROM oven/bun:1.3.13-alpine

WORKDIR /app
COPY --from=headlamp /headlamp /headlamp
COPY plugin/dist /headlamp/plugins/highstate-dashboard
COPY plugin/package.json /headlamp/plugins/highstate-dashboard/package.json
COPY dist ./

CMD ["bun", "index.js"]
