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
Backend persistence can use local encrypted SQLite or PostgreSQL.
PostgreSQL stores backend federation key metadata encrypted for AGE recipients; it does not encrypt all backend rows.
Selecting PostgreSQL does not change the per-project encrypted SQLite or artifact encryption boundaries.
Hosted startup requires a provisioned stable AGE identity, independent of the encrypted metadata in PostgreSQL.
The Prisma schemas and registered migration packs own exact records, relationships, and migration behavior.
Filesystem paths, environment variables, and operator procedures belong in public or source-adjacent
documentation.

## Recovery Boundary

A recovery set spans backend metadata and key envelopes, encrypted project databases, artifacts, authored
models, and the stable backend identity.
Restoring one persistence realm independently does not establish a consistent recovered backend.
Project unlock credentials remain independent of the backend identity.

The Kubernetes deployment supports offline recovery sets by stopping the owning runtime and its Docker
workloads before capturing the persistent filesystem and PostgreSQL metadata together.
Encrypted project databases remain opaque files, including their journal companions; no live filesystem
copy or plaintext SQLite export is part of that procedure.
An independent bootstrap runtime or operator coordinates the stop, capture, and restart lifecycle.
The source-owned [Kubernetes application guide](../../packages/standard/k8s.apps/README.md) owns the procedure
and deployment requirements.

## Unlock Boundary

Unlocking is runtime activation, not a presentation state.
The backend decrypts the project master key, keeps it in the unlock backend, opens and migrates the project
database, and runs tasks that rehydrate evaluation, operations, workers, terminals, references, and related
state.
Locking the project or stopping the backend removes access to the process-local key and services that depend on
it.
Manual locking requires backend authorization and an idle project: active operations, workers, or terminal
sessions prevent locking rather than being interrupted.
The lock boundary stops reload-triggered evaluation, revokes unlock material, evicts cached project database
access, and publishes the locked state to connected clients.

Project unlock metadata is self-contained rather than referencing a backend-level identity registry.
Projects reuse a discoverable WebAuthn credential without a backend credential registry or source-project lookup.
Each new passkey method encrypts its own AGE identity using that credential's PRF extension.
System keyring methods encrypt their own AGE unlock identities using one shared keyring wrapping identity.
New unlock methods carry encrypted AGE identity envelopes with each project.
The wrapping identity remains outside project storage, in a single keyring entry; encrypted envelopes live only
in their respective projects.
Transferring project data does not transfer access to an OS keyring or change a passkey's WebAuthn relying party.
The project unlock service and its shared models own identity preparation and unlock-suite compatibility.
Startup keyring unlocking is an explicit per-method opt-in persisted with the project's unlock metadata.
Sharing an unlock identity does not propagate that opt-in to other projects.
Project keyring access runs in a short-lived native helper process to isolate native keyring failures from
the Designer runtime; secrets cross that process boundary only through private standard streams.

Public API authorization for project resources depends on project data and therefore requires the project to
be unlocked.
An API process without the unlock state and project database cannot act as a stateless replica for those
requests.

## Authorization Realms

Backend authorization and project authorization are separate realms.
Public ConnectRPC requests authenticate API keys and resolve service-account role grants in the applicable
realm.
The designer defaults to a trusted-local user model.
Hosted Designer authenticates human identities with OAuth/OIDC and durable opaque browser sessions,
then resolves user and group role grants independently in the backend and project realms.
Known human identities belong to the backend directory.
Authorized project administrators can browse that directory to assign a user's first project role without
requiring prior project participation; this does not merge authorization realms or grant project access by itself.
Hosted mode never falls back to operating-system identity, and authentication alone grants no business permissions.
Deployment-configured administrator identities receive grants during realm initialization.
Revoking those grants permanently requires removing the deployment configuration and the persisted bindings.
Designer streaming and panel capabilities remain bound to the browser session's expiry and revocation.
Hosted authentication requires TLS except for explicitly enabled loopback development, which uses separate browser cookies.
The development exception is unavailable in production and does not relax identity or authorization checks.
Project-scoped authorization also applies when a runtime manager indexes resources globally.
Stream delivery remains subject to the caller's grants for the lifetime of the subscription.

Code in the backend API authentication layer, designer tRPC context, business services, and authorization
schemas owns the exact permission checks.
Designer synchronizes advisory access hints for visible interactions; those hints never authorize a business operation.
Role and permission inventories remain in those sources rather than architecture documentation.

## Secret Metadata

Domain entity secret wrappers carry secrecy metadata across JSON transport and asynchronous materialization.
They remain schema-compatible domain values rather than depending on Pulumi output types.
The Pulumi runtime interprets that metadata at resolved resource-input registration, protecting wrapped values
without hiding public sibling properties.
The contract secret schema and `packages/platform/pulumi/src/secrets.ts` own the exact representation and adapter.

## Isolation And Ownership

Each project has independent operational data and key material.
Data crosses a project boundary only through an explicit sharing mechanism such as a project import.
Sharing does not merge project databases, authorization realms, or operation ownership.

Runtime ownership is defined by the [control-plane coordination boundary](control-plane.md#coordination-boundary).

## Pull Request Execution

Fork verification and preview builds execute contributor code without repository write permissions or secrets.
Privileged preview publication runs separately and treats build artifacts as untrusted data, not executable tools.
Only base-repository code determines publication destinations and updates pull request comments.
GitHub run metadata binds artifacts to the current pull request head; stale builds cannot update its preview comment.
The workflows in `.github/workflows/` own the exact permissions and artifact handoff.
