# Infrastructure Design

Use this reference to design a Highstate project or bring existing infrastructure under Highstate management.
Use `component-authoring` for implementation details and `infrastructure-management` for CLI changes and operations.

## Model The Infrastructure

A project contains a graph of component instances connected through typed entities.
A component defines a reusable contract; an instance supplies its name, arguments, secrets, and connections.
Units implement infrastructure behavior with Pulumi programs.
Composites create and connect other components while keeping their units independently manageable.

Start with the services the user needs, their dependencies, and the resources that already exist.
Identify boundaries such as provider connections, servers, clusters, storage, databases, DNS, and applications.
Represent dependencies with entity connections rather than copying addresses and credentials into each consumer.
Keep ordinary configuration in arguments and sensitive values in secrets.
Use separate projects when independent access and state isolation are needed; share entities explicitly when required.

## Reuse The Library First

Inspect the project's loaded library and the schemas of likely matches before proposing custom code:

```bash
highstate library list --output json
highstate component get <component-type> --output json
highstate component schema <component-type> --output json
```

Choose the closest matching library units by lifecycle, provider support, inputs, and outputs, not just title.
Check whether their configuration and extension points cover the user's requirements.
Compose existing units when the missing capability is wiring or policy rather than a new resource implementation.
Write a custom unit only when no suitable library unit can express the required behavior.
Keep that unit focused on the missing capability and expose entity types that connect to the rest of the library.

For example, `k8s.apps.postgresql.v1` deploys a PostgreSQL server on Kubernetes and exports a PostgreSQL connection.
`postgresql.database.v1` consumes that connection to create a database and user, then exports their connection.
These are separate lifecycles, not interchangeable implementations of the same component.

## Bring Existing Infrastructure Under Management

Inventory existing resources, data, dependencies, credentials, and the system currently responsible for changes.
Agree on which resources Highstate should merely connect to and which it should create, update, or destroy.
Prefer the most closely matching library units for each part of that inventory, falling back to custom units only
for unsupported behavior.

Existing-resource units provide useful entry points:

- `common.existing-server.v1` accepts an existing server endpoint and SSH configuration and exports a server entity
- `k8s.existing-cluster.v1` accepts a kubeconfig secret and exports a Kubernetes cluster entity

Connect those entities to downstream components instead of provisioning replacement servers or clusters.
For example, an existing Kubernetes cluster can host new library-managed applications and databases.
An existing server can supply a server entity to components that configure services on that host.
Check what each downstream unit changes before deploying it to an existing system.

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
Use distinct instance names and environment-specific resource names, domains, and storage targets.
When environments share a Kubernetes cluster, set application names and namespaces explicitly rather than
assuming that different Highstate instance names override a unit's application defaults.
Separate projects can instantiate the same composite when environments need project-level isolation.

Keep provider-specific provisioning outside an application composite when the application only needs a cluster,
database connection, or access point.
This lets the same deployment pattern run on an existing cluster or on a newly provisioned one.
Expose meaningful differences such as capacity, domain, scheduling, and optional integrations without making
every internal child setting part of the public contract.

Two useful composition patterns are:

- A cluster platform receives server entities and a DNS provider, composes K3s, networking, Gateway API,
  certificate management, and ingress, then exports a cluster entity and an access point
- An application stack receives a cluster and access point, provisions PostgreSQL, creates separate application
  databases, and connects those database outputs to the application; an optional Restic repository enables the
  database unit's backup integration

For the cluster pattern, pass the output of each cluster-enhancement unit to the next so consumers receive the
configured cluster rather than bypassing its dependencies.
For the application pattern, give multiple children of the same component type distinct deterministic names,
such as `<stack>.auth-db` and `<stack>.app-db`.
Keep reusable defaults independent of personal domains, account IDs, and machine-specific paths.

## Verify The Design

Confirm that the selected component types exist in the target project's library and that entity contracts connect.
Inspect the evaluated child graph for stable names, correct dependencies, and unintended shared resources.
Type-check and build custom library and implementation packages before planning deployment.
Review the operation plan for unexpected creates, replacements, or destroys, especially during adoption.
Use `infrastructure-management` for approval, deployment, and result verification.
