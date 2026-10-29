# Project Library

Library execution separates durable project intent from backend-local placement.
The encrypted project database owns exact package selections, immutable resolved snapshots, evaluated models,
and deployment provenance.
The backend database owns reconstructible snapshot images and runtime workload inventory.
Moving execution does not make a container image the only copy of the project's dependency graph.

## Catalog And Execution

A proposed package set is resolved, integrity-checked, evaluated, and checked for duplicate component and
entity types before its selection and snapshot commit together.
Image materialization follows that commit, so an image failure does not roll back the selected snapshot.
Operations wait for the required image rather than falling back to an older desired environment.
The project-library service, npm resolver, snapshot store, and snapshot-image manager own exact behavior.

Authored instance models identify component types without package or snapshot fields.
The snapshot's ownership index resolves those types to package versions.
Deployed and operation state retain exact snapshot membership, allowing historical code to remain available
after the desired catalog changes.
[Project Lifecycle](project-lifecycle.md) owns planning and execution provenance rules.

## Development Sources

The optional local library overlay is a backend-host development source, not a portable package snapshot.
It is available only on the well-known local Docker runtime.
A component or entity conflict disables the complete overlay rather than merging an arbitrary subset.
Overlay revisions fence evaluation and reviewed plans independently of packaged snapshot identity.
Local execution retains the local runner; it does not gain packaged historical provenance.

## Reconstruction

Snapshot reconstruction uses the frozen dependency graph and integrity-verified registry archives.
Missing packages or incompatible tooling fail explicitly rather than selecting replacement versions.
Image cache generations fence build callbacks so superseded work cannot overwrite the current build.
Cache deletion does not bypass workload cleanup.
The [project library design](../design/project-library.md) describes the integrated lifecycle and validation coverage.

## Retention

Project unlock collects library history by durable reachability rather than age.
Desired snapshots, deployed instance provenance, stored evaluation state, retained operation history, runtime
actions, and image builds awaiting cleanup preserve their referenced snapshots.
Completed runtime actions retain snapshots while their action records remain stored.
Unreferenced snapshots and package versions can be collected; package versions referenced by previous operation
state also remain retained.

Collection removes corresponding backend image cache records without deleting daemon or registry images.
Runtime workload cleanup remains separately owned by the runtime coordinator and adapters.
`packages/platform/backend/src/library/garbage-collection.ts` owns the exact reachability queries, and
`packages/platform/backend/src/services.ts` owns unlock integration.
