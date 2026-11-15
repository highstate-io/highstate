# Container Runtime

## Overview

**Status: Implemented.**
Docker and Kubernetes adapters, durable workload and action coordination, runtime agents, TLS transport,
snapshot image builds, runtime-backed execution managers, migrations, and settings controls exist.
The composition root wires these services, and API startup owns the optional dedicated TLS listener lifecycle.
The default preflight composition supplies registry image checks and an authenticated disposable workload probe.
Live remote Docker and Kubernetes environments are unavailable for lifecycle validation; adapter tests do not
establish that validation.
This is a validation limitation rather than a remaining implementation boundary.
The sections below describe the integrated runtime and its validation coverage.

The design gives each project one container runtime independently of Pulumi state placement.
Current execution boundaries belong to [Control Plane](../architecture/control-plane.md#execution-boundaries).
The local runner remains available for local overlays and deployments whose historical packaged provenance is
unknown; those paths have not been replaced by snapshot workloads.

The [project library design](project-library.md) defines how project library snapshots are built into images
through this runtime.

## Boundaries

The container runtime adapter owns generic image, environment, workload, network, log, attach, and execution
mechanics for Docker or Kubernetes.
It does not own Pulumi planning, sidecar semantics, terminal sessions, worker registrations, library package
resolution, or project persistence.
Those behaviors remain in workload-specific managers that translate domain requests into generic runtime
operations.

The workload managers cover:

- A Pulumi operation manager for operation-scoped runner workloads.
- A composite evaluation manager for snapshot-scoped evaluation workloads.
- A sidecar manager for operation-scoped supporting workloads.
- A terminal manager for interactive sessions and persisted terminal logs.
- A worker manager for supervised long-running worker versions.
- A project library build manager for snapshot image materialization.

The backend remains the owner of orchestration, locking, operation recovery, authorization, persistence,
credentials, and workload leases.
Containers are execution boundaries, not security boundaries for untrusted code.

Domain managers operate on Pulumi operations, evaluations, builds, sidecars, workers, and terminals rather
than Docker containers or Kubernetes resources.
An internal runtime coordinator converts those requests into generic workload intents and persists one logical
workload record before asking the selected adapter to place it.
The workload-facing gRPC protocol is separate from this backend-to-adapter interface: agents connect to the
backend through gRPC, while adapters are backend-owned implementations that call Docker or Kubernetes APIs.

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

The runtime specifies an OCI image repository when built images must be pushed.
It is optional for local Docker and required for remote Docker and Kubernetes.
Kubernetes additionally specifies the rootless BuildKit image used by image-build Jobs; Docker builds through
the engine API and does not require a builder image.

Runtime implementations report capabilities explicitly, including image building, local image retention,
registry pushes, interactive attachment, command execution, workload networking, and persistent volumes.
Managers reject requests that the selected runtime cannot support instead of relying on engine-specific
failure behavior.

Runtime settings expose adapter preflight checks for engine or cluster connectivity and configuration.
The integrated host supplies a registry check for the configured runner base image and a disposable workload
probe that waits for an authenticated runtime agent stream.
The probe requires a configured runner base image and an existing project assigned to the runtime.
It requests cleanup after success, failure, timeout, or cancellation and reports cleanup failures.
A successful preflight is not verification of every image-build, attach, storage, or networking path.
Remote Docker settings support client TLS material independently of the workload-facing runtime API TLS
configuration.
Write-only kubeconfig, Docker TLS, Pulumi, npm, and container registry secrets are preserved when omitted from
an update and replaced only when explicitly supplied.
Runtime updates use an optimistic settings revision so concurrent edits and stale full replacements fail.

## Generic Operations

The common runtime contract supports:

- Engine and credential preflight checks.
- Image lookup, pull, build, push, and immutable digest verification.
- Isolated workload environments and operation-scoped DNS.
- One-off and long-running workloads.
- Workload inspection, health, stop, force stop, and cleanup.
- Structured log streaming.
- Interactive attachment with binary input and output and terminal resizing.
- Command execution in running workloads.
- Labels and runtime ownership metadata for recovery and garbage collection.

Every workload receives opaque backend, project, runtime, workload, and operation identifiers as applicable.
Docker resources and Kubernetes resources carry these identifiers as labels.
The backend uses labels and persisted leases to reconcile stale resources after restart.

The backend persists every Highstate-owned logical workload, including its runtime, project, kind, domain
owner, desired and observed states, native root resource handle, lease generation and expiry, and cleanup
state.
Agent-backed workloads own persistent action records for each independently cancellable Pulumi or evaluation
execution, including status, cancellation state, snapshot and image identity, timestamps, and terminal error.
One runner may execute multiple actions, while one-shot evaluation workloads own one action.
Workloads own placement, connectivity, leases, and cleanup; actions own dispatch, cancellation, and termination.
Existing operation and evaluation records remain authoritative for domain outcomes rather than duplicating
those outcomes in runtime records.
It does not persist every engine-created child resource: a Kubernetes Deployment, ReplicaSet, Pod, Service,
and Secret or a Docker container, network, and volume remain adapter details discovered through ownership
labels.
Unrelated resources not labeled as Highstate-owned are outside this inventory.

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

Operation workloads and dynamically created sidecars join one operation environment and use operation-scoped
DNS.
The design removes generated `/etc/hosts` files, loopback IP allocation, `unshare`, and host networking from
Pulumi-sidecar communication.

The sidecar caller supplies its complete DNS name from a stable Pulumi resource or connection identity.
That name is an immutable sidecar identity, is persisted in Pulumi state, and is exposed unchanged by every
runtime.
Runtime adapters do not append suffixes or include operation, workload, container, Pod, or Service identifiers
in it.
Creating the same name and declaration again within an operation reuses the logical sidecar; a different
declaration with the same name fails.
Separate operation environments may use the same name concurrently because DNS visibility is scoped to the
operation.

Docker exposes the name as an alias on the operation bridge network.
Engine resource names remain opaque and unique independently of that alias.

## Kubernetes Placement

Pulumi operations run in operation-scoped Pods.
Sidecars run as separate Pods behind uniquely named Services.
Each operation workload uses an operation-specific DNS resolver that maps its caller-owned sidecar names to
those Services and forwards other queries to cluster DNS.
The resolver gives concurrent operations isolated DNS views without requiring caller-visible names to be
valid or unique Kubernetes resource names.

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
The authenticated connection identifies its workload, and the stream correlates concurrent work with action
and request IDs.
The backend derives operation ownership from the action, including agent-originated unit and sidecar requests.

The protocol carries:

- Protocol negotiation, workload registration, heartbeats, and lease renewal.
- Composite evaluation requests, generated virtual instances, branch errors, and invalid results.
- Pulumi action requests, engine events, standard output, standard error, completion, and errors.
- Unit configuration requests and result submission.
- Sidecar creation and lifecycle responses.
- Worker identity and typed registration, deregistration, and stop events.
- Graceful cancellation and forced termination.

Worker HTTP panel traffic uses a dedicated streaming RPC per request, separate from the control stream.
Worker agents open a bounded pool of reverse channels so the backend can dispatch requests over outbound
worker connections without requiring an inbound worker endpoint.
The contract preserves method, path and query, state and panel routing, repeated headers, status, and body bytes.
Headers precede bounded body chunks; transport half-close ends each body and gRPC status reports failures.
Implementations await transport and downstream backpressure and bound channel queues and buffering.
This carries the current HTTP panel capability without introducing generic logical byte streams or windows.

`ClientHello` and `ServerHello` are the first messages in their respective directions.
The workload advertises a supported protocol range and capabilities, and the backend selects one version or
rejects the connection.
Identifiers required by an event are validated from its envelope and cannot be reused for concurrent work.
A typed evaluation result terminates that action, `ActionCompleted` terminates a Pulumi command action, and
`RuntimeError` terminates the request when a request ID is present, otherwise the action.
Connection failures use gRPC status.
Cancellation always targets an action; the backend fans operation cancellation out to its active actions.
A cancellation response only acknowledges the request; it does not indicate that the action has terminated.
Worker connections receive current registrations followed by live typed changes, as in the existing worker API;
registration revision reconciliation is deferred until a concrete replay requirement exists.

Unit payloads preserve the existing `UnitConfig` capabilities, including input values and provenance, invoked
triggers, structured secrets, instance identity, and runner-local import paths.
Sidecar declarations preserve command and arguments, secret files and modes, named TCP ports, readiness,
and runner-reachable host and port mappings from the domain runtime contract.
Component-owned values retain their dynamic JSON shape rather than introducing a second domain schema.

The [security architecture](../architecture/data-and-security.md#isolation-and-ownership) owns workload
credential and trust boundaries.
TLS uses normal certificate verification, with an explicitly configured CA bundle for private PKI.

## Workload Communication

Pulumi runner images and Highstate workers contain a runtime agent and communicate directly through the
runtime gRPC stream.
The agent owns Pulumi and provider subprocesses, maps actions to process groups, and isolates cancellation of
concurrent unit actions.
Normal cancellation sends an interrupt to one action; force cancellation kills only that action before an
operation-wide workload stop is considered.

The runner is a disposable execution agent, not an owner of durable state.
It holds active processes, temporary workspaces, loaded implementations, short-lived secrets, and buffered
events only while running.
Pulumi state remains in the selected state backend, project and operation state remains in the project
database, workload leases remain in the backend database, and artifacts and logs use their configured durable
stores.
Loss of a runner fails its active actions rather than resuming its memory; a retry starts a new runner and
reconciles through Pulumi state.

Composite evaluation runs as a short-lived workload from the selected project library snapshot image.
The backend sends the complete resident instance graph, resolved inputs, project-specific virtual component
definitions, and model and local-overlay revisions as one independently cancellable action.
The workload returns generated virtual instances and ordinary branch errors; project-level validation failures
invalidate the complete result, while process or transport failures use the runtime error event.
The backend owns duplicate-ID validation, revision fencing, persistence, and publication of evaluation state.
Persisted evaluation state records the snapshot, resident model revision, local-overlay revision, and runtime
action that produced it so later planning can reject stale virtual models after a backend restart.

Arbitrary terminal images are not required to contain Highstate software.
The terminal manager uses the internal Docker or Kubernetes adapter attach interface directly; terminal I/O
does not travel over the workload-agent gRPC protocol.

Application data traffic between a unit and its sidecar remains direct over the runtime network.
It is not proxied through the control stream.
Worker control uses the runtime agent stream and panel/proxy traffic uses dedicated reverse streaming RPCs,
so workers do not depend on backend-host Unix socket mounts or host-published loopback ports.

Project library materialization is an adapter-owned logical workload rather than a workload-agent action.
The build manager supplies the snapshot ID and hash, build generation, frozen lockfile, source manifest,
compatibility requirements, immutable base image, target platforms, and optional push repository through the
internal adapter interface.
The Docker adapter drives the engine build API, while the Kubernetes adapter owns a rootless BuildKit Job.
Adapter progress callbacks report stable phases and the verified image reference, digest, and image hash.
The backend accepts updates only for the image cache's current workload and generation, preventing an obsolete
build from replacing a newer desired image.

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

`PulumiStateBackend` replaces the former `PulumiBackend` concept and remains separate from
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
The backend reconciles resources by labels and leases, interrupts actions without a live connection, and
cleans expired or orphaned workloads.
Worker supervision remains responsible for starting required worker versions after project unlock.
Cleanup failures remain visible and retryable rather than being treated as successful finalization.
Project and runtime deletion first marks owned workloads for deletion and completes adapter cleanup; database
relations restrict deleting those owners while workload records still retain cleanup state.

## Compatibility And Validation

The legacy local runner remains a migration and development compatibility path.
Its removal requires an explicit replacement for unknown-provenance deployments and local overlays.

The live verification matrix includes local Docker, remote Docker, and Kubernetes image builds, Pulumi lifecycle
commands, sidecar DNS, terminal attachment, worker reconnection, runtime API disconnects, cancellation, restart
reconciliation, and credential isolation.
The presence of adapter and coordinator tests does not mark that matrix complete.
Focused probe tests cover scoped authentication, placement failures, timeout, cancellation, assignment races,
and cleanup failure reporting.
