# Container Runtime

## Overview

**Status: Proposed.**

Highstate currently has separate local implementations for Pulumi execution, Docker sidecars, Docker
terminals, and Docker workers.
Pulumi Automation API programs run on the backend host, sidecars use host networking and generated hosts
files, and workers reach the backend through a mounted Unix socket.
Kubernetes placement and a common runtime protocol are not implemented.

The intended design replaces these execution-specific backends with one project-selected container runtime.
It supports local or remote Docker engines and Kubernetes workloads in a configured namespace.
Local Docker is the default.
Pulumi operations, sidecars, terminals, workers, and project library image builds all use the same runtime
selected by their project.

The [project library design](project-library.md) defines how project library snapshots are built into images
through this runtime.

## Boundaries

The container runtime owns generic image, environment, workload, network, log, attach, and execution
mechanics.
It does not own Pulumi planning, sidecar semantics, terminal sessions, worker registrations, library package
resolution, or project persistence.
Those behaviors remain in workload-specific managers that translate domain requests into generic runtime
operations.

The intended managers are:

- A Pulumi operation manager for operation-scoped runner workloads.
- A sidecar manager for operation-scoped supporting workloads.
- A terminal manager for interactive sessions and persisted terminal logs.
- A worker manager for supervised long-running worker versions.
- A project library build manager for snapshot image materialization.

The backend remains the owner of orchestration, locking, operation recovery, authorization, persistence,
credentials, and workload leases.
Containers are execution boundaries, not security boundaries for untrusted code.

## Project Selection

Each project references one reusable backend-scoped `ContainerRuntime`.
All project workloads use that runtime; individual units, sidecars, terminals, workers, and libraries cannot
select a different runtime.
A project also references a separate reusable `PulumiStateBackend`, because workload placement and Pulumi
state storage are independent concerns.

The default runtime is the well-known local Docker runtime.
Moving a project to another backend or runtime does not require moving cached library images because they can
be rebuilt from project library snapshots.

Runtime settings also identify the backend runtime API URL reachable by workloads and the npm and container
registry credentials available to the runtime.
The URL uses TLS and must be reachable from the Docker daemon or Kubernetes cluster.

## Runtime Specifications

A Docker runtime specifies the engine endpoint, whether it is local to the backend, the workload-reachable
runtime API URL, and applicable registry credentials.
The Docker adapter supports both local and remote engines.
A compatible Podman endpoint may be used through the Docker-compatible API when it satisfies the required
capabilities; Podman does not require a separate domain type.

A Kubernetes runtime specifies its cluster connection, context when needed, namespace, service account,
workload-reachable runtime API URL, image-pull configuration, and OCI image builder.
Highstate creates Kubernetes resources only in the configured namespace.
Kubernetes image builds use an unprivileged OCI builder such as rootless BuildKit and require a configured
remote container registry.
Privileged Docker-in-Docker is not part of the design.

Runtime implementations report capabilities explicitly, including image building, local image retention,
registry pushes, interactive attachment, command execution, workload networking, and persistent volumes.
Managers reject requests that the selected runtime cannot support instead of relying on engine-specific
failure behavior.

## Generic Operations

The common runtime contract supports:

- Engine and credential preflight checks.
- Image lookup, pull, build, push, and immutable digest verification.
- Isolated workload environments and runtime-provided DNS.
- One-off and long-running workloads.
- Workload inspection, health, stop, force stop, and cleanup.
- Structured log streaming.
- Interactive attachment with binary input and output and terminal resizing.
- Command execution in running workloads.
- Labels and runtime ownership metadata for recovery and garbage collection.

Every workload receives opaque backend, project, runtime, workload, and operation identifiers as applicable.
Docker resources and Kubernetes resources carry these identifiers as labels.
The backend uses labels and persisted leases to reconcile stale resources after restart.

## Docker Placement

Local Docker can retain project library images in its local image store and can mount local library sources
into Pulumi workloads.
It supports operation-scoped bridge networks, engine attach and exec, and persistent local volumes.

Remote Docker receives build contexts, artifact files, and runtime configuration through network or engine
APIs.
It cannot use paths or Unix sockets from the backend host.
Images needed by remote Docker are pushed to the configured container registry and subsequently addressed by
immutable digest.
Local library overlays are unavailable on remote Docker.

Operation workloads and dynamically created sidecars join one operation environment and use runtime DNS.
The design removes generated `/etc/hosts` files, loopback IP allocation, `unshare`, and host networking from
Pulumi-sidecar communication.

## Kubernetes Placement

Pulumi operations run in operation-scoped Pods.
Sidecars share the operation Pod when their declaration and lifecycle allow them to be known before Pod
creation.
Dynamically created or independently managed sidecars run as separate Pods with operation-scoped Services or
DNS names.

Terminal sessions run in Pods and use Kubernetes attach or exec for interactive traffic.
Worker versions run as Deployments and use Services only where direct workload data endpoints are necessary.
One-off library builds run as Jobs using the configured OCI builder.

All resources include project and runtime ownership labels.
Operation finalization removes operation-scoped Pods, Services, Secrets, and other temporary resources.
Long-running workers remain supervised by the worker manager and are reconciled when projects unlock.

## Runtime API

Runtime communication uses a separate versioned protobuf API at
`io/highstate/runtime/v1/runtime.proto`, exported as `@highstate/api/runtime.v1`.
It is distinct from the public `io.highstate.v1` API and the worker-specific
`io.highstate.worker.v1` API.

The primary service is an authenticated bidirectional gRPC stream owned by the backend.
Runtime-aware workload agents connect outward to the configured backend URL.
The stream multiplexes logical sessions using runtime instance, workload, operation, action, request, and
stream identifiers.

The protocol carries:

- Protocol negotiation, workload registration, heartbeats, and lease renewal.
- Pulumi action requests, engine events, standard output, standard error, completion, and errors.
- Unit configuration requests and result submission.
- Sidecar creation and lifecycle responses.
- Worker registration, control, panel, and proxy traffic.
- Terminal input, output, resize, close, and exit events.
- Graceful cancellation and forced termination.

Terminal and proxy payloads use protobuf byte fields.
Flow control is bounded per logical stream so one noisy workload cannot exhaust backend memory or block other
sessions.

Each workload receives a short-lived credential scoped to its backend, project, runtime, workload ID, kind,
expiry, and allowed protocol operations.
The backend validates the scope of every message.
TLS uses normal certificate verification, with an explicitly configured CA bundle for private PKI.

## Workload Communication

Pulumi runner images and Highstate workers contain a runtime agent and communicate directly through the
runtime gRPC stream.
The agent owns Pulumi and provider subprocesses, maps actions to process groups, and isolates cancellation of
concurrent unit actions.
Normal cancellation sends an interrupt to one action; force cancellation kills only that action before an
operation-wide workload stop is considered.

Arbitrary terminal images are not required to contain Highstate software.
The Docker or Kubernetes adapter attaches to those workloads and translates engine I/O into the same internal
runtime stream representation used by the terminal manager.

Application data traffic between a unit and its sidecar remains direct over the runtime network.
It is not proxied through the control stream.
Worker control and panel/proxy traffic use the runtime stream so workers do not depend on backend-host Unix
socket mounts or host-published loopback ports.

## Images And Registries

Container registry credentials are backend-scoped and selected by the normalized registry URL in an image
name.
Npm registry credentials are backend-scoped and selected by package scope, such as `@highstate/` or `@acme/`.
Credentials are passed through engine secrets, BuildKit secrets, or temporary Kubernetes Secrets and never
persisted in image layers, labels, build manifests, or logs.

Local Docker may retain a built image without pushing it.
Remote Docker and Kubernetes require a configured registry and immutable pushed digest.
The project library design defines the durable snapshot from which any missing image can be rebuilt.

## Pulumi State

`PulumiStateBackend` replaces the current `PulumiBackend` concept and remains separate from
`ContainerRuntime`.
It stores a Pulumi backend URL and encrypted authentication configuration reusable by projects.
An operation workload receives only the state configuration selected by its project.

Filesystem-backed state requires runtime-specific persistent storage.
Local Docker may use a managed volume or explicit host path, remote Docker requires storage on the daemon
host, and Kubernetes requires a persistent volume claim.
Changing runtimes does not migrate filesystem-backed Pulumi state automatically.

## Failure And Recovery

A runtime connection loss interrupts affected in-flight actions.
Highstate does not replay a Pulumi action automatically because infrastructure may have changed before the
failure.
Operation recovery marks interrupted work failed and later retries operate on potentially partial state.

Runtime image caches and stale workload records are reconstructible.
The backend reconciles resources by labels and leases, preserves persistent workers that should still run,
and removes orphaned operation resources.
Cleanup failures remain visible and retryable rather than being treated as successful finalization.

## Delivery

Implementation proceeds by establishing the runtime contract and API first, then moving terminals, workers,
sidecars, and Pulumi operations behind it.
Docker local remains the first complete adapter, followed by remote Docker and Kubernetes.
The old runner, terminal, worker, sidecar Docker implementations and the `unshare` command wrapper are removed
only after their consumers use the generic runtime.

Verification covers local Docker, remote Docker, and Kubernetes for image builds, Pulumi lifecycle commands,
sidecar DNS, terminal attachment, worker reconnection, runtime API disconnects, cancellation, restart
reconciliation, and credential isolation.
