# Project Library

## Overview

**Status: Proposed.**

Highstate currently assigns one backend-scoped library to each project and loads package definitions and unit
sources from the backend host's local workspace or `node_modules`.
The project does not persist a reproducible package resolution, project library image, package-version
provenance, or image-build progress.

The intended design makes libraries project-scoped npm package selections stored in the encrypted project
database.
Each project has a reproducible `LibrarySnapshot` containing the resolved lockfile for all packaged libraries
and dependencies.
The selected [container runtime](container-runtime.md) builds that snapshot into an image used by project
operations.
Backend-level `LibrarySnapshotImage` records are disposable runtime caches because any image can be rebuilt
from its snapshot.

## Package Model

A `LibraryPackage` represents one npm package containing Highstate component and entity definitions.
It stores the package name, one exact selected npm version, display order, and timestamps.
Each project starts with a package selection for `@highstate/library`.

Available versions come from the npm registry selected by package scope.
The project stores exact selected versions, not dist-tags or semantic version ranges.
Npm metadata and package archives remain authoritative; project records capture selections and reproducible
resolutions.

A `LibraryPackageVersion` is an immutable cache for one evaluated exact package version.
It records its package, exact version, registry, package integrity, evaluated package library model, source
manifest, and relevant package metadata.
It can be recreated from npm and may be garbage-collected when no snapshot or instance state references it.

Different configured packages in one project cannot export the same component or entity type.
Version updates are evaluated and checked for conflicts before project selections change.
Projects are isolated, so equal types in different projects do not conflict.

## Library Snapshot

A `LibrarySnapshot` is an immutable description of the complete packaged library environment for one project.
It contains:

- The resolved lockfile for all direct library packages and transitive dependencies.
- Exact versions, package integrity values, and registry resolution needed for frozen installation.
- The merged evaluated component and entity model.
- Source manifests and component ownership metadata.
- Runtime, package-format, Bun, and Pulumi compatibility requirements.
- A deterministic hash over canonical snapshot content.

The snapshot is the durable portability boundary.
An image is derived cache data and is never the only copy of information required to reproduce execution.
Rebuilding uses frozen lockfile semantics and fails if package resolution would change.

A snapshot has explicit relations to every direct `LibraryPackageVersion` used in it.
These relations preserve cached versions, expose package and version information efficiently, and identify the
package version that owns each component.
The lockfile remains authoritative for the complete dependency graph.

The project database records its current desired snapshot.
Adding, removing, reordering, or changing the selected version of a package creates a new immutable snapshot.
Older snapshots remain available while referenced by deployed instance state or operation history.

## Snapshot Images

`LibrarySnapshotImage` is a backend-database cache keyed by project, runtime, and snapshot identity.
It records the project snapshot ID and hash, selected runtime, build status and progress, immutable image
reference and digest, errors, and timestamps.
The relation to a project-database snapshot is logical because backend and project databases are separate.
Highstate verifies the snapshot hash before using a cache entry.

Local Docker may retain the image only in its daemon.
Remote Docker and Kubernetes push the image to the container registry configured for the project runtime and
use its immutable digest.
Deleting a snapshot image record or moving a project to another backend or runtime does not lose project
state.
The receiving backend reads the snapshot, rebuilds the image, verifies its hash and runtime protocol, and
creates a new cache record.

The fixed Highstate runner image is the build base.
Custom library base images are not supported initially.
The resulting image contains the runtime agent, release-aligned Bun and Pulumi tooling, frozen npm dependency
graph, unit implementations, merged evaluated model, and source manifests.
It never contains npm credentials, container registry credentials, project secrets, or Pulumi state
credentials.

## Build Lifecycle

Package selection changes create a desired snapshot and enqueue its image materialization on the project's
single selected runtime.
Build progress is persisted in the backend cache and exposed to the Designer.
Stable phases include queued, resolving, installing, evaluating, validating, building, pushing, verifying,
ready, and failed.

Resolution and evaluation happen for the complete proposed package set.
Highstate commits a version change only after it can produce a valid conflict-free snapshot.
A failed proposal leaves the previous selected versions and desired snapshot unchanged.
A build failure after snapshot creation leaves the new snapshot selected but unavailable for operations until
the image is successfully retried or package selection changes again.

When several changes arrive, a queued obsolete generation can be superseded.
An already running build may finish, but it does not become the current image when its snapshot is no longer
desired.

Project creation resolves `@highstate/library`, creates the first snapshot, and starts the first image build.
If this fails, the project remains available for settings and diagnostics but component operations remain
blocked.

## Package Updates

The library UI lists each configured package, selected exact version, available versions from npm, evaluation
state, and current snapshot image status.
It provides an exact version selector, an update action for one package, and an update-all action.

Updating one package evaluates the candidate exact version together with all currently selected packages,
checks component and entity conflicts, resolves a new complete lockfile, and atomically commits the selected
version and snapshot.

Updating all packages resolves the latest eligible exact version for each package and validates the proposed
set as one transaction.
If any package cannot be fetched, verified, evaluated, or merged, none of the selected versions change.

Npm credentials are reusable backend-scoped records identified by normalized npm scope.
Container credentials are reusable backend-scoped records identified by normalized registry URL.
The project runtime references the credentials available for package resolution, image building, pushing, and
pulling.
Credential values are encrypted and never returned after creation or replacement.

## Effective Catalog

The effective project catalog combines the desired successful packaged snapshot, project-specific virtual
components, and an optional local library overlay.
Catalog entries expose package and version provenance to the UI and planner, but this provenance is not added
to authored instance models.

The component selector supports package filtering and displays the selected package version and source.
It also shows project image build progress, failures, package update actions, and local-overlay status.

An authored `InstanceModel` continues to store only its component type and existing instance fields.
It does not store a library package ID, package version ID, or snapshot ID.
Component type uniqueness within the effective packaged snapshot makes type sufficient for authored desired
state.
Resolution uses the snapshot's ownership index to map an instance type to its owning
`LibraryPackageVersion`.

## Instance Provenance

`InstanceState` records both the `LibrarySnapshot` and `LibraryPackageVersion` used by the last successful
non-preview component operation.
The snapshot identifies the complete image and dependency graph.
The package version identifies the direct package that supplied the component implementation.

Operation and per-instance operation state also snapshot these references so reviewed plans, logs, recovery,
and history remain stable when project package selections later change.
Preview uses the desired snapshot but does not advance deployed provenance.
A successful update or recreate stores the operation snapshot and owning package version.
A failed or cancelled operation retains the previous references.

Planning compares the deployed package version with the desired snapshot's owner of the instance component
type.
When they differ, the unit is outdated and the operation preview displays a structured package upgrade badge,
including the package name and old and new versions.
The instance therefore retains its current deployed version until its next successful Pulumi operation even
though the project catalog and image have already advanced.

Refresh and destroy operations that execute program code use the deployed historical snapshot.
If its image is absent on the selected runtime, Highstate rebuilds it from the stored lockfile before
execution.
This preserves the code and dependency environment that last managed the resources.

## Operation Barrier

Every operation captures one immutable snapshot before planning.
Planning resolves every packaged instance against that snapshot, and execution uses the matching verified
image.

If the desired snapshot image is queued or building, new component operations remain pending in the
orchestrator.
They do not run against the previous image.
Waiting operations remain cancellable and expose the current build phase.
A failed build blocks the operations with the associated actionable error.

Changing the desired snapshot invalidates a previously reviewed plan.
Launch rejects a supplied plan whose snapshot no longer matches the desired snapshot and requires the user to
review a new plan.

## Local Library Overlay

Local libraries remain a special development source backed by the project-local workspace or `node_modules`.
They are optional and available only when the project uses the well-known local Docker runtime because unit
execution requires host bind mounts.
Remote Docker and Kubernetes disable them with an explanation.

Local libraries do not create `LibraryPackage`, `LibraryPackageVersion`, `LibrarySnapshot`, or
`LibrarySnapshotImage` records.
They do not alter the packaged snapshot lockfile and do not trigger project image rebuilds.
Their source and definition hashes still trigger composite reevaluation and mark affected instances outdated.

The complete local overlay is disabled when any local component or entity type conflicts with the packaged
snapshot.
Highstate reports the conflicts and does not merge only the non-conflicting subset.
Local instance state has no package-version or packaged-snapshot provenance and continues to rely on local
source and model hashes.

An operation containing packaged and local units uses the packaged snapshot image with explicit local source
mounts.
Those mounts are a development overlay and are not represented by the image or snapshot hash.

## Persistence And Portability

`LibraryPackage`, `LibraryPackageVersion`, and `LibrarySnapshot` live in the encrypted project database.
This keeps package selections, reproducible resolutions, evaluated models, and deployed provenance with the
portable project.

`LibrarySnapshotImage` and runtime workload records live in the backend database because they describe
backend-local placement and caches.
They can be discarded and reconstructed.

Portability does not require copying container images.
It does require retaining the complete resolved lockfile and enough registry configuration to fetch the exact
integrity-verified package archives.
If an authoritative registry no longer serves a locked package, image reconstruction fails explicitly rather
than silently selecting another version.

## APIs

Project library APIs expose package listing, add and remove, available npm versions, exact version selection,
update one, update all, version details, desired snapshot, effective catalog, image build progress, and local
overlay controls.
Changes require project-scoped authorization because the records live in the project database.

The public project model and component APIs continue to identify instances by component type.
Operation plan responses add structured package-upgrade information rather than requiring clients to parse
human-readable planning messages.

Backend settings APIs manage container runtimes, Pulumi state backends, npm registry credentials, and
container registry credentials.
Secret credential fields are write-only.

## Migration

Migration removes the backend-level `Project.libraryId` and `Project.pulumiBackendId` links after replacement
runtime and Pulumi state backend references exist.
It creates the default local Docker runtime and converts existing host Pulumi state configuration.

For each existing project, migration identifies configured library packages and exact installed or registry
versions, creates project-scoped package rows, resolves a frozen lockfile, evaluates package ownership, creates
the initial snapshot, and builds its runtime image.
Authored `InstanceModel` values and codebase-backed project YAML do not gain package or snapshot fields.

Deployed instance states are backfilled only when their component type has one unambiguous package owner and
the exact historical package version is known.
Local or unresolved sources retain null package-version provenance.
Migration must not claim that a newly resolved npm version is the historical code used for an existing
deployment.
The old executable environment remains available until affected states are upgraded or destroyed when exact
historical provenance cannot be reconstructed.

## Delivery

Implementation first introduces project package and snapshot persistence, npm resolution, conflict checking,
and catalog assembly.
It then adds runtime image building and progress, operation barriers, instance provenance, historical image
reconstruction, Designer package controls, and local overlay restrictions.

Verification covers frozen reconstruction, package integrity, update-all atomicity, conflict rejection,
credential selection, progress and retry behavior, operation waiting and cancellation, stale plan rejection,
upgrade badges, preview provenance, historical destroy and refresh, local overlay conflicts, and project
migration between runtimes and backends.
