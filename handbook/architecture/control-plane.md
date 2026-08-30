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
Those interfaces are extension seams, not claims that multiple supported implementations exist.
Current factories expose local databases and artifacts, a local library and runner, Docker workers and
terminals, and process-local unlock, pubsub, and lock implementations.

## Embedding And Transports

The designer's Nitro process is the integrated local host.
It creates the backend services and mounts three different access paths:

- Designer tRPC is a trusted local UI facade over the in-process service graph.
- ConnectRPC exposes public and worker APIs around the same domain services.
- MCP acts as a client of the ConnectRPC boundary.

The CLI also imports backend services directly.
`@highstate/backend-api` can expose an existing service graph over HTTP or a Unix socket, but it does not
assemble or own the backend runtime.
Business behavior therefore belongs below transport adapters rather than in tRPC, ConnectRPC, or MCP handlers.

The source entry points are `packages/platform/designer/server/`,
`packages/platform/backend-api/src/index.ts`, and `packages/platform/cli/src/shared/services.ts`.

## Execution Boundaries

Different workloads cross different isolation boundaries:

| Workload | Current boundary |
| --- | --- |
| Backend and designer API | One Bun/Nitro process |
| Composite evaluation | A fresh Node worker thread |
| Unit deployment | A local Pulumi Automation API program using Bun |
| Background worker | A backend-supervised Docker container |
| Interactive terminal | A backend-supervised Docker container |
| Unit sidecar | A Docker container controlled through the unit runtime |

Pulumi programs use an ephemeral, operation-scoped loopback API.
They do not call the public backend API.
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
