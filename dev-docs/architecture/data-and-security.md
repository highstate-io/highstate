# Data And Security

Highstate separates global backend data, per-project data, and process-local runtime state.
Unlocking connects these realms and grants one backend temporary access to a project's decrypted material.

## Persistence Realms

| Realm | Responsibilities |
| --- | --- |
| Backend database | Projects, spaces, libraries, backend authorization, encrypted project keys, and project database versions |
| Project database | Evaluation, operations, instances, secrets, artifacts, workers, and project authorization |
| Project model storage | Authored instances and hubs in codebase or database storage |
| Runtime memory | Decrypted project material and ephemeral backend state |

Backend and project schemas have separate migration lifecycles.
The Prisma schemas and registered migration packs own exact records, relationships, and migration behavior.
Filesystem paths, environment variables, and operator procedures belong in public or source-adjacent
documentation.

## Unlock Boundary

Unlocking is runtime activation, not a presentation state.
The backend decrypts the project master key, keeps it in the unlock backend, opens and migrates the project
database, and runs tasks that rehydrate evaluation, operations, workers, terminals, references, and related
state.
Locking the project or stopping the backend removes access to the process-local key and services that depend on
it.

Public API authorization for project resources depends on project data and therefore requires the project to
be unlocked.
An API process without the unlock state and project database cannot act as a stateless replica for those
requests.

## Authorization Realms

Backend authorization and project authorization are separate realms.
Public ConnectRPC requests authenticate API keys and resolve service-account role grants in the applicable
realm.
The designer's local tRPC path uses a separate trusted-local user model and is outside the public
authentication contract.

Code in the backend API authentication layer, designer tRPC context, business services, and authorization
schemas owns the exact permission checks.
Role and permission inventories remain in those sources rather than architecture documentation.

## Isolation And Ownership

Each project has independent operational data and key material.
Data crosses a project boundary only through an explicit sharing mechanism such as a project import.
Sharing does not merge project databases, authorization realms, or operation ownership.

Runtime ownership is defined by the [control-plane coordination boundary](control-plane.md#coordination-boundary).
