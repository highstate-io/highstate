FROM oven/bun:1.3.13 AS build
WORKDIR /source
COPY . .
RUN bun install --frozen-lockfile --filter @highstate/backend
RUN bun build packages/platform/backend/src/runtime-agent/main.ts packages/platform/backend/src/runtime-agent/child.ts --target=bun --external=@highstate/contract --external=@pulumi/pulumi --external=@grpc/grpc-js --external=protobufjs --outdir=/agent
RUN bun build packages/platform/contract/src/index.ts --target=bun --outfile=/agent/empty-library-contract/index.js && bun -e 'await Bun.write("/agent/empty-library-contract/package.json", JSON.stringify({name: "@highstate/contract", type: "module", exports: "./index.js"}))'
RUN bun -e 'const names = ["@pulumi/pulumi", "@grpc/grpc-js", "protobufjs"]; const dependencies = Object.fromEntries(names.map(name => [name, require(`./packages/platform/backend/node_modules/${name}/package.json`).version])); await Bun.write("/agent/package.json", JSON.stringify({private: true, dependencies}))'
RUN cd /agent && bun install --production

FROM pulumi/pulumi-nodejs:3.232.0
COPY --from=build /usr/local/bin/bun /usr/local/bin/bun
COPY packages/platform/backend/docker/pulumi-language-bun /pulumi/bin/pulumi-language-bun
RUN chmod +x /pulumi/bin/pulumi-language-bun && pulumi-language-bun --version
COPY --from=build /agent /opt/highstate/runtime-agent
RUN mkdir -p /opt/highstate/runtime-agent/node_modules/@highstate && ln -s /opt/highstate/library/node_modules/@highstate/contract /opt/highstate/runtime-agent/node_modules/@highstate/contract
RUN mkdir -p /opt/highstate/library/node_modules/@highstate && cp -r /opt/highstate/runtime-agent/empty-library-contract /opt/highstate/library/node_modules/@highstate/contract
COPY packages/platform/api/protocol /opt/highstate/protocol
COPY packages/platform/api/vendor /opt/highstate/vendor
RUN mkdir -p /opt/highstate/protocol/google/protobuf && cp /opt/highstate/runtime-agent/node_modules/protobufjs/google/protobuf/descriptor.proto /opt/highstate/protocol/google/protobuf/descriptor.proto
WORKDIR /opt/highstate/library
ENTRYPOINT ["bun", "/opt/highstate/runtime-agent/main.js"]
