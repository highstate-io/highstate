# Control Plane

Highstate currently runs as an embedded control plane rather than a separately assembled backend service.
This topology determines its process, failure, and deployment boundaries.

## Composition

`packages/platform/backend/src/services.ts` is the backend composition root.
It assembles adapters, lifecycle managers, transport-neutral business services, evaluation, and operation
orchestration into one service graph.
The exact service inventory and configuration remain source-owned.

The adapter interfaces separate domain behavior from persistence, execution, coordination, workers, and
terminals.
Persistence and coordination remain local to the backend process.
Execution adapters support Docker engines and Kubernetes namespaces through a shared runtime coordinator.
Workload-specific managers retain domain behavior; adapters own placement, images, networking, logs, attach,
and cleanup.
The [container runtime design](../design/container-runtime.md) describes the integrated lifecycle and validation coverage.

## Embedding And Transports

The designer's Nitro process is the integrated local host.
It creates the backend services and mounts two different access paths:

- Designer tRPC is a trusted local UI facade over the in-process service graph.
- ConnectRPC exposes public and worker APIs around the same domain services.

Workload agents use a separate authenticated TLS gRPC listener.
The runtime transport accepts an existing coordinator; the embedding host owns listener startup and shutdown.
Backend API startup enables the optional listener from explicit options or TLS environment configuration and
closes it with the public API.
`packages/platform/backend-api/src/runtime-server.ts` owns the listener contract.

The CLI manages active backends as a ConnectRPC client.
It also imports backend services directly for local backend administration and integrated development commands.
`@highstate/backend-api` can expose an existing service graph over HTTP or a Unix socket, but it does not
assemble or own the backend runtime.
Business behavior therefore belongs below transport adapters rather than in tRPC, ConnectRPC, or CLI commands.
Multi-step model mutations remain atomic within the selected project-model adapter; transports submit the
operation but do not implement its read-modify-write behavior.

The source entry points are `packages/platform/designer/server/`,
`packages/platform/backend-api/src/index.ts`, and `packages/platform/cli/src/shared/services.ts`.

## Execution Boundaries

Different workloads cross different isolation boundaries:

| Workload | Current boundary |
| --- | --- |
| Backend and designer API | One Bun/Nitro process |
| Packaged composite evaluation | A disposable snapshot-image workload |
| Packaged unit deployment | A snapshot-image workload running Pulumi through a runtime agent |
| Local or unknown-provenance unit deployment | The retained local runner and executable environment |
| Background worker | A supervised workload on the project's runtime |
| Interactive terminal | Adapter-managed workload with direct attach |
| Unit sidecar | A workload in the operation's isolated runtime network |

The project selects one container runtime independently of its Pulumi state backend.
Runtime workloads and actions persist placement, lease, cancellation, and cleanup identity without becoming
owners of project outcomes.
Agent-backed Pulumi communication crosses the runtime stream; terminal I/O uses the adapter directly.
The retained local runner still uses its operation-scoped loopback API.
[Contracts and Extensions](contracts-and-extensions.md#worker-connectivity) defines worker connectivity.

## Coordination Boundary

Unlocked project keys, locks, pubsub subscriptions, active operations, and worker and terminal ownership are
held by the backend process.
These choices make the process a coordination boundary and prevent safe active-active ownership of one
project.
One backend can load multiple projects, but only one backend may actively own a particular project.

Generated database clients, federation identifiers, and adapter interfaces do not establish a supported
distributed deployment.
Horizontal coordination becomes supported only when the relevant factories expose durable distributed
implementations and the ownership model changes accordingly.
