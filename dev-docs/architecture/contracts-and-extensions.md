# Contracts And Extensions

Highstate has separate domain, remote, and internal contracts.
Choosing the wrong surface turns a local change into an accidental wire or runtime dependency.

## Contract Surfaces

| Surface | Purpose | Source authority |
| --- | --- | --- |
| `@highstate/contract` | TypeScript domain and extension contracts | `packages/platform/contract/src/` |
| Protobuf and ConnectRPC | Remote client and worker compatibility | `packages/platform/api/protocol/` |
| Designer tRPC | Trusted local designer access | `packages/platform/designer/server/` |
| Runtime gRPC | Authenticated workload-agent control and worker reverse proxy | `packages/platform/api/protocol/io/highstate/runtime/` |
| Local unit runtime tRPC | Retained local-runner Pulumi communication | Backend runner and `packages/platform/pulumi/src/` |

The Protobuf files, not generated TypeScript descriptors, own remote compatibility.
Their owning source also remains authoritative for schema fields, RPC inventories, permissions, and generated
declarations.

[Control Plane](control-plane.md#embedding-and-transports) defines how the current hosts use these contract
surfaces.

## Dependency Direction

Platform contracts and API definitions sit inward of their consumers.
The backend depends on the domain contract, while transport packages adapt backend services to remote APIs.
Library packages depend inward on the domain contract, Pulumi helpers, and other libraries.
Worker packages depend on the API contract and worker SDK rather than the backend.

Package manifests and the generated workspace graph own the exact dependency graph.
Domain behavior remains independent of a specific UI or remote transport across extension and transport
layers.

## Library Artifact Protocol

A Highstate library is an executable extension package.
The CLI build produces executable JavaScript, a serialized component and entity model, and a source manifest.
The backend uses these artifacts for composite evaluation, unit source resolution, rebuild detection, and
deployment change detection.

Compatibility therefore includes more than npm exports and TypeScript types:

- Package metadata and build commands identify a Highstate-managed package.
- Executable and serialized definitions represent the same library build.
- Source manifests describe deployable unit implementations.

[Compatibility](compatibility.md#runtime-alignment) defines the runtime alignment constraint.

The CLI builder and backend library loader own exact artifact names, paths, and schemas.
Artifacts produced through those tools participate in the supported protocol; independent reimplementations
do not gain compatibility from this architectural description.

## Worker Connectivity

Workers are backend-supervised workloads on the project's selected runtime.
Runtime-aware workers connect outward through the authenticated runtime stream for registration and control.
Panel and proxy requests travel over dedicated reverse streaming RPCs with bounded buffering and backpressure.
They do not require backend-host socket mounts or inbound loopback data ports.
The worker's ordinary project API client remains separate from runtime workload authentication.

The worker SDK retains its legacy connection mode when runtime launch options are absent.
That SDK compatibility does not make an old worker image compatible with runtime-aware launch options.
The worker SDK, runtime Protobuf service, backend worker manager, and proxy implementation own exact messages
and launch mechanics.
