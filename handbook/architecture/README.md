# Architecture

Highstate is a visual infrastructure control plane built around a graph of component instances and Pulumi
units.
This section covers boundaries and compatibility constraints that affect multiple packages or subsystems.

## Guides

- [Control Plane](control-plane.md) describes composition, embedding, execution, and deployment boundaries.
- [Contracts and Extensions](contracts-and-extensions.md) distinguishes domain, wire, and internal contracts.
- [Project Lifecycle](project-lifecycle.md) follows desired state through evaluation, planning, and execution.
- [Data and Security](data-and-security.md) defines persistence, trust, unlock, and ownership boundaries.
- [Compatibility](compatibility.md) records release, runtime, API, extension, and persistence constraints.
