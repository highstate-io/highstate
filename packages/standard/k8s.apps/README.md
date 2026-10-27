# Highstate on Kubernetes

`k8s.apps.highstate.v1` runs the production Designer and its embedded backend in one pod.
It uses PostgreSQL for backend metadata and a persistent volume for encrypted project databases,
artifacts, authored models, workspace files, and Pulumi data.
One backend owns this data at a time.

## Requirements

- Kubernetes 1.29 or newer with native sidecars enabled and CSI `ReadWriteOncePod` support.
- A storage class that supports `ReadWriteOncePod`, or an existing PVC with that access mode.
  With an existing PVC, the unit uses that PVC's namespace, which must already permit privileged pods.
- A dedicated PostgreSQL database and password-authenticated connection.
  The image installs PostgreSQL client 18 from PGDG by default.
  For a newer server, set the Docker build argument `POSTGRESQL_CLIENT_VERSION` to a matching or newer supported major.
  TLS connections verify the server hostname and certificate using the supplied CA entity or the system trust bundle.
  An explicitly `insecure` connection disables TLS and cannot also supply a CA.
- An HTTPS access point, DNS name, and at least one `auth.login-provider.v1` connection.
  The access point must support wildcard DNS and TLS issuance for `*.panels.<fqdn>` (normally DNS-01).
- A cluster policy that permits the privileged Docker sidecar and the runtime's unconfined seccomp and AppArmor profiles.
  Nodes must permit user namespaces: the local Pulumi runner uses `unshare` for per-operation hosts files.

Docker-in-Docker has ephemeral image and container storage.
The daemon belongs exclusively to this runtime; application startup removes surviving containers after a restart.
Workers, terminals, and unit sidecars use the existing Docker backends.
The pod does not use the node's Docker socket or the node network namespace.
Docker's own host-network containers share the pod network namespace.

## Build and select images

From a checkout with a synchronized lockfile:

```sh
docker buildx bake --file docker/docker-bake.hcl highstate --load
```

Without buildx, use the same Dockerfile with the classic builder:

```sh
DOCKER_BUILDKIT=0 docker build -f docker/highstate.dockerfile -t highstate:local .
```

The Bake target also participates in `docker-images:publish-images`.
The build bootstraps the CLI, builds Designer and its dependencies, and includes the workspace library.
It contains Bun, Node, Pulumi, Docker CLI, kubectl, Restic, rclone and PostgreSQL client tools.
The image currently retains build dependencies and workspace sources.

Push the image to your registry and supply its resulting digest as `image`.
Supply a compatible Docker daemon image, such as a Docker 28 DinD build, by digest as `dockerImage`.
Both arguments require `repository@sha256:<64 lowercase hex characters>`.
No pre-existing Highstate image tag is assumed.

## Configure the unit

Connect these inputs:

| Input | Purpose |
| --- | --- |
| `k8sCluster` | Kubernetes cluster |
| `accessPoint` | HTTPS route |
| `postgresql` | Dedicated backend database |
| `loginProviders` | One or more runtime login capabilities |
| `volume` | Optional existing `ReadWriteOncePod` PVC |
| `resticRepo` | Optional rclone-backed Restic repository |

Set `fqdn`, `image`, `dockerImage`, and at least one of `initialAdminUserIds` or `initialAdminGroupIds`.
Register `https://<fqdn>/api/auth/callback` as the login client's redirect URI.
`appName` defaults to `highstate`; it determines the namespace and deployment name.
When `volume` is connected, its existing namespace replaces the namespace derived from `appName`.
`storageSize` defaults to `20Gi`; `storageClassName` selects the CSI storage class.
Set `maintenance=true` to deploy with zero replicas for recovery.

Admin IDs are Highstate's stable identity IDs, not email addresses or provider display names.
Compute them using the backend's public helpers in a Highstate workspace:

```sh
bun -e 'import { getOidcUserId, getOidcUserGroupId } from "@highstate/backend"; console.log(getOidcUserId("https://issuer.example", "subject")); console.log(getOidcUserGroupId("https://issuer.example", "admins"))'
```

For OAuth2 profiles, use `getOAuthUserId(authority, subject)` and `getOAuthUserGroupId(authority, group)`.
The authority or OIDC issuer must match the provider configuration exactly.
Admin grants are initialized once by hosted authentication; changing these arguments is not a role-management API.

The unit generates stable `backendIdentity` and `backupKey` secrets through Highstate's secret lifecycle.
For recovery, supply the original `backendIdentity` explicitly.
Keep the backup key and repository credentials independently of this deployment and its bootstrap backend.
The backup key is required to open Restic and is deliberately not stored inside its own encrypted backup.
When connecting an already initialized repository, set `backupKey` to its existing password.

### Runtime configuration

The runtime Secret mounts at `/recovery`:

- `providers.json`: a JSON array validated by `loginProviderConfigSchema`, with unwrapped client credentials.
- `initial-admins.json`: `{ "userIds": ["..."], "groupIds": ["..."] }`.
- `backend-identity`: the stable AGE identity.
- `postgresql-url`: the backend connection string.
- `postgresql-ca.crt`: the optional custom PostgreSQL trust bundle, also included in recovery material.

The runtime uses `HIGHSTATE_AUTH_MODE=hosted`, `HIGHSTATE_PUBLIC_URL=https://<fqdn>`,
`HIGHSTATE_AUTH_PROVIDERS_FILE=/recovery/providers.json`,
`HIGHSTATE_AUTH_INITIAL_ADMINS_PATH=/recovery/initial-admins.json`,
`HIGHSTATE_BACKEND_DATABASE_TYPE=postgresql`, `HIGHSTATE_BACKEND_DATABASE_POSTGRESQL_URL`,
`HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH=/recovery/backend-identity`, and `HIGHSTATE_ENCRYPTION_ENABLED=true`.
The entrypoint translates the admin document to JSON arrays in `HIGHSTATE_AUTH_ADMIN_USER_IDS` and
`HIGHSTATE_AUTH_ADMIN_GROUP_IDS`.

The entrypoint waits for Docker before starting Bun/Nitro and runs from `/data/workspace`.
`HOME=/data/home`, `PULUMI_HOME=/data/pulumi`, and the runner cache is `/data/cache`.
The immutable library workspace is `/opt/highstate`; custom libraries need a rebuilt image.
The runtime and daemon mount `/data`, `/tmp`, `/run/user/0`, and `/run/highstate-docker`
at the same absolute paths.
Mounting `/tmp` itself prevents the DinD wrapper from hiding shared files beneath a private tmpfs.
The worker API uses the existing root-user default `/run/user/0/highstate.sock`.
All three Docker backend host settings and `DOCKER_HOST` point to
`unix:///run/highstate-docker/docker.sock`.
The Debian `unshare` tool lacks `--forward-signals`, so that runner option is disabled.
The unit routes base panel hosts under `*.panels.<fqdn>`.
Applications that use deeper nested panel hosts need additional DNS, gateway and TLS configuration;
a wildcard certificate for `*.panels.<fqdn>` does not cover those deeper names.

## Coordinated backup

Backup has downtime.
Run it from an independent bootstrap Highstate instance or an operator terminal with kubectl.
Do not manage this unit's backup trigger from the Highstate runtime it will stop.
Finish active operations first; stopping a pod cannot roll back partially applied external infrastructure changes.
The dedicated metadata database must have no other writers.
Pause external reconcilers that would change deployment replicas during maintenance.

The generated `<appName>-offline-backup` CronJob is suspended and serves only as a Job template.
Do not unsuspend it or create Jobs directly from it.
Its pod checks the maintenance lock, zero replicas, and absence of runtime pods before reading data.
The CSI exclusive-pod mount prevents a replacement runtime from mounting the PVC during capture.

Initialize the Restic repository once before the first backup.
In an independent tools container with kubectl access, export the generated backup Secret to files:

```sh
umask 077
export NAMESPACE=highstate
kubectl -n "$NAMESPACE" get secret highstate-backup -o jsonpath='{.data.password}' | base64 -d > password
kubectl -n "$NAMESPACE" get secret highstate-backup -o jsonpath='{.data.rclone\.conf}' | base64 -d > rclone.conf
export RESTIC_REPOSITORY="$(kubectl -n "$NAMESPACE" get secret highstate-backup -o jsonpath='{.data.repository}' | base64 -d)"
export RESTIC_PASSWORD_FILE="$PWD/password"
export RCLONE_CONFIG="$PWD/rclone.conf"
restic init
```

Download `backup.sh` from the unit's Operations page and run:

```sh
export NAMESPACE=highstate DEPLOYMENT=highstate BACKUP_TEMPLATE=highstate-offline-backup
sh backup.sh
```

The coordinator acquires a namespace maintenance lock, scales the deployment to zero, waits for all runtime
pods to disappear after the Deployment controller observes scale-down, creates a backup Job, and resumes only
after successful completion and Job pod removal.
The exclusive-pod PVC prevents either pod from starting until CSI has released its previous mount.
The maintenance lock stays held through the resumed rollout.
The before-destroy trigger uses the same coordinator and leaves replicas at zero.
It requires kubectl on the independent bootstrap runtime and uses a temporary secret kubeconfig.

Each `highstate-coordinated` Restic snapshot contains `/data` and `/backup` together:

- The entire stopped project tree, including encrypted libSQL files and their WAL/SHM companions.
- Artifacts, authored model files, workspace data, Pulumi data and project key envelopes.
- `/backup/backend.pgdump`, a consistent PostgreSQL custom-format dump including backend key metadata.
- `/backup/recovery`, containing the runtime credentials, identity and login/admin configuration.
- A format/image manifest and capture timestamp.

This procedure preserves encrypted libSQL as opaque files after all writers have stopped.
It does not use an unencrypted SQLite tool or copy a live database.
Restic encrypts the complete recovery set, including the backend identity and PostgreSQL metadata.
Docker's disposable data is excluded.
There is no automatic retention policy or scheduled filesystem copy; use Restic retention tools separately.

If preflight fails before shutdown is attempted, the coordinator releases its lock without changing replicas.
Failures after shutdown is attempted retain `highstate-backup-lock` and do not automatically resume Highstate.
If the resumed rollout fails, replicas may already be restored; inspect the Deployment as well as the Job.
Inspect the Job and its logs, remove the failed Job and wait for its pods to disappear, then remove the lock.
Retry the coordinator, or scale the deployment to one after resolving the failure.
Do not delete the lock while another coordinator is running.

## Recovery

1. Set `maintenance=true` and deploy the same image digest recorded in the backup manifest.
   Restore into a new, empty PVC and a new dedicated PostgreSQL database.
   Keep the original runtime stopped throughout recovery.
2. In a tools pod mounting the target PVC at `/data`, configure Restic using the independently saved
   repository credentials and backup key.
   Run `restic snapshots --tag highstate-coordinated` and choose one completed snapshot ID.
3. Run `restic restore <snapshot-id> --target /restore`.
   Copy the complete `/restore/data/.` into the empty PVC, preserving owners, permissions and dotfiles:
   `cp -a /restore/data/. /data/`.
   Preserve WAL and SHM companions; do not open encrypted databases with ordinary sqlite3.
4. Restore metadata with the matching or newer PostgreSQL client:
   `pg_restore --dbname="$NEW_DATABASE_URL" --no-owner --no-acl --exit-on-error /restore/backup/backend.pgdump`.
   Restore the whole dump, including the backend bootstrap/key table.
5. Supply `/restore/backup/recovery/backend-identity` as the unit's `backendIdentity` secret.
   Restore the provider/admin configuration and original public origin, or deliberately reconfigure the provider
   registrations for a new origin before enabling traffic.
   Connect the new PostgreSQL database; the old URL in the backup is recovery context, not the new destination.
6. Remove the tools pod so it releases the exclusive PVC mount.
   Set `maintenance=false` and deploy.
   Sign in, unlock each project with its existing unlock method, and verify model, artifacts, operation history
   and Pulumi state before running updates.
   Reconcile interrupted infrastructure operations against the actual providers.

The backend AGE identity is not a replacement for a user's project unlock credentials.
Restoring only PostgreSQL, only project databases, or only artifacts is not a complete recovery.
The namespace and newly created PVC are retained when Pulumi removes the unit; clean them up explicitly
after recovery data is no longer needed.
