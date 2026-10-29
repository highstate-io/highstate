# Registry fixtures

The registry harness builds real library and Pulumi implementation packages with the built workspace CLI.
It requires built `@highstate/cli`, `@highstate/contract`, and `@highstate/pulumi` products, Bun, and GNU tar.
The registry roundtrip test also imports the built backend and downloads external npm dependencies.

From the workspace root, build the products and run the fixture roundtrip:

```sh
bunx --bun nx run @highstate/cli:build
bunx --bun nx run @highstate/pulumi:build
bun run --bun --filter @highstate/e2e test
```

The test builds all variants, inspects the archives, resolves both library releases through the backend's
`NpmProjectLibraryResolver`, reconstructs their frozen graphs, and rejects the conflicting library.

## Starting a registry

Import the harness from `packages/e2e/src/harness/registry.ts`:

```ts
import { prepareFixtures, startRegistry } from "./src/harness/registry"

const fixtures = await prepareFixtures()
const registry = await startRegistry({ fixtures })
try {
  // Configure the selected runtime's @highstate registry to registry.url.
  // registry.localUrl is available for requests from the host itself.
} finally {
  await registry.cleanup()
  await fixtures.cleanup()
}
```

`prepareFixtures({ workspaceRoot?, directory? })` returns `PreparedFixtures` containing the staging directory,
package archives and integrity digests, and an asynchronous cleanup method.
`directory` is an existing parent for a unique temporary directory.
Build-time dependency links are removed before packing.
Workspace dependencies in the packaged closure use exact release versions, and catalog references are expanded.
The archives contain no workspace `node_modules`.

`startRegistry({ fixtures?, hostname?, port?, publicHost?, upstream? })` returns `FixtureRegistry`.
It listens on all host interfaces and an ephemeral port by default.
`publicHost` controls the hostname advertised in metadata and archive URLs; it must be reachable from both the
backend and runner containers.
The default is the first non-loopback IPv4 address, with loopback as a fallback.
Use `publicHost: "127.0.0.1"` for host-only tests.
`localUrl` uses loopback and assumes the default listener or another listener reachable through loopback.

The registry serves fixture packages locally and forwards other package metadata to npm by default.
It always rejects missing `@highstate/*` packages rather than falling back to a public release.
Set `upstream: false` when unknown packages should return 404.
When `fixtures` is omitted, registry cleanup also removes its generated fixtures.
When fixtures are supplied, the caller owns their cleanup.

## Lifecycle inputs

Select `@highstate/e2e-library` at exact version `1.0.0` or `2.0.0`.
Both versions export the unit type `e2e.marker.v1` and composite type `e2e.composite.v1`.
Both types take the same arguments:

```ts
{
  endpoint: "http://host-reachable-from-runner:12345",
  key: "unique-resource-key",
  value: "initial-value",
}
```

`endpoint` is an absolute URL and `key` is nonempty.
The composite creates a marker child named `<composite-name>-child`.
The `marker` output is an `e2e.marker.v1` entity with `{ marker: string, value: string }`.
The implementation package is `@highstate/e2e-resources` at the matching library version.
Its `./marker` export resolves to `dist/marker/index.js`; `./provider` exports the dynamic provider and resource.
The releases embed `v1` and `v2` respectively, so their implementation source hashes differ.
OpenTelemetry API is pinned to `1.9.1` in the implementation fixture to satisfy Pulumi's 1.x SDK peer constraints.

The HTTP service at `endpoint` implements these paths:

| Request | Behavior |
| --- | --- |
| `POST /resources/<encoded-key>` | Store the JSON resource state on create |
| `GET /resources/<encoded-key>` | Return the current state, or 404 when absent |
| `PUT /resources/<encoded-key>` | Store the new state on update |
| `DELETE /resources/<encoded-key>` | Delete the state |

Writes contain `{ endpoint, key, value, marker }`.
Every request includes `x-highstate-marker: v1` or `v2`.
Changing `value` updates the resource; changing `endpoint` or `key` replaces it.
Changing the remote `value` directly allows a refresh scenario to observe drift.
Deletion responses must be successful even when the service has already removed the record.

`@highstate/e2e-conflicting@1.0.0` also exports `e2e.marker.v1`, with incompatible `{ conflicting: number }`
arguments and a different implementation source.
Select it together with the ordinary library to exercise duplicate-type rejection during resolution.
