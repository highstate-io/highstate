# Design

Highstate design documents describe the current and intended shape of systems that span packages or
subsystems.
They remain synchronized with implementation progress and complement, but do not override, the implemented
boundaries in the [architecture guide](../architecture/README.md).

Each design states its implementation status in its overview.
Partially implemented designs distinguish existing behavior from behavior that remains intended.

## Designs

- [Container Runtime](container-runtime.md) defines the common workload placement and communication model for
  Pulumi operations, sidecars, terminals, workers, and library image builds.
- [Project Library](project-library.md) defines project-scoped npm libraries, reproducible snapshots, runtime
  image caches, local overlays, and instance execution provenance.
