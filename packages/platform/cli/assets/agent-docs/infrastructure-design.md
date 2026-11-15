# Infrastructure Design

Use this reference to design a Highstate project or bring existing infrastructure under Highstate management.
Use `component-authoring` for implementation details and `infrastructure-management` for CLI changes and operations.

## Model The Infrastructure

Start with the services the user needs, their dependencies, and the resources that already exist.
Identify boundaries such as provider connections, servers, clusters, storage, databases, DNS, and applications.
Represent dependencies with entity connections rather than copying addresses and credentials into each consumer.
Use separate projects when independent access and state isolation are needed; share entities explicitly when required.

## Reuse The Library First

Choose the closest matching library units by lifecycle, provider support, inputs, and outputs, not just title.
Check whether their configuration and extension points cover the user's requirements.
Compose existing units when the missing capability is wiring or policy rather than a new resource implementation.
Write a custom unit only when no suitable library unit can express the required behavior.
Use `infrastructure-management` to inspect the available library and `component-authoring` when an extension is needed.

## Bring Existing Infrastructure Under Management

Inventory existing resources, data, dependencies, credentials, and the system currently responsible for changes.
Agree on which resources Highstate should merely connect to and which it should create, update, or destroy.
Apply the library-first selection above to each part of that inventory.
Existing-resource units such as `common.existing-server.v1` and `k8s.existing-cluster.v1` let a design reuse existing
hosts and clusters rather than provisioning replacements.
For example, connect an existing cluster to new library-managed applications and databases while leaving cluster
provisioning with its current owner.

Connecting to an existing resource does not automatically import all of its resources into Pulumi ownership.
For resources that must themselves become managed, inspect the unit implementation and provider's import or
adoption support, including identifiers and expected configuration.
Do not assume that creating a matching Highstate instance adopts the existing object without replacement.
Where adoption is unsupported, explain whether a custom unit or an explicit migration is required.
Avoid concurrent management of the same resource by Highstate and the previous tool.
Plan data migration, backups, cutover, and rollback before changing ownership of stateful services.

## Reuse Deployment Patterns With Composites

Prefer a composite for a recurring stack or a shared organizational configuration.
Put common topology and defaults in the composite; supply environment-specific configuration through arguments
and dependencies through typed inputs.
Instantiate the same composite for development, staging, and production rather than copying its child graph.
Keep environment-specific resource names, domains, storage targets, and namespaces separate to avoid collisions.
Separate projects can instantiate the same composite when environments need project-level isolation.

Keep provider-specific provisioning outside an application composite when the application only needs a cluster,
database connection, or access point.
This lets the same deployment pattern run on an existing cluster or on a newly provisioned one.
Useful project layers include:

- A cluster platform receives server entities and a DNS provider, composes K3s, networking, Gateway API,
  certificate management, and ingress, then exports a cluster entity and an access point
- An application stack receives a cluster, access point, and optional backup repository, and groups its application
  services and databases independently of the underlying platform

Reuse these layers across environments while varying capacity, domains, scheduling, and external integrations.

## Share Data Through Project Ports

Reuse shared infrastructure data through project export and import ports rather than duplicating connection
configuration or copying credentials between projects.
Keep shared resources in their owning project and export the entities that consuming projects need, such as a
cluster, access point, DNS provider, or backup repository.
Use composites to reuse topology; use project ports to reuse the outputs of already deployed instances.

An export port selects outputs and destination projects; the corresponding import ports expose those entities
to local consumers in each destination.

For example, a platform project can export its configured Kubernetes cluster and access point to application
projects, while a storage project exports a Restic repository to projects that need backups.
Each application project can connect those imports to its own deployment composite without recreating the
cluster, ingress, or backup repository.

Ports distribute exported entity snapshots; they do not transfer resource ownership or automatically deploy
consumers when the source changes.
Account for propagation of shared-output changes when planning updates across project boundaries.
Export only the entities needed by each destination: connection entities can include credentials and referenced
data, so sharing them grants more than access to a display label or endpoint.
