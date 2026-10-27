FROM oven/bun:1.3.13 AS build
WORKDIR /source
COPY . .
RUN bun install --frozen-lockfile
RUN bun build packages/platform/backend/src/runtime-agent/main.ts packages/platform/backend/src/runtime-agent/child.ts --target=bun --external=@pulumi/pulumi --external=@grpc/grpc-js --external=protobufjs --outdir=/agent
RUN bun -e 'const names = ["@pulumi/pulumi", "@grpc/grpc-js", "protobufjs"]; const dependencies = Object.fromEntries(names.map(name => [name, require(`./packages/platform/backend/node_modules/${name}/package.json`).version])); await Bun.write("/agent/package.json", JSON.stringify({private: true, dependencies}))'
RUN cd /agent && bun install --production

FROM pulumi/pulumi-nodejs:3.232.0
COPY --from=build /usr/local/bin/bun /usr/local/bin/bun
COPY --from=build /agent /opt/highstate/runtime-agent
COPY packages/platform/api/protocol /opt/highstate/protocol
COPY packages/platform/api/vendor /opt/highstate/vendor
RUN mkdir -p /opt/highstate/protocol/google/protobuf && cp /opt/highstate/runtime-agent/node_modules/protobufjs/google/protobuf/descriptor.proto /opt/highstate/protocol/google/protobuf/descriptor.proto
WORKDIR /opt/highstate/library
ENTRYPOINT ["bun", "/opt/highstate/runtime-agent/main.js"]
