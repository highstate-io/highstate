# Yandex Cloud Orca Environments

The Yandex Cloud provider creates preemptible virtual machines from a reusable authenticated image.
Shared lifecycle behavior is documented in the [Orca VM guide](../README.md).

## Prerequisites

The provider requires Bash, `yc`, `jq`, `ssh`, an SSH key pair, and an authenticated Yandex Cloud CLI.
Cloud-init creates the configured SSH user, which defaults to `dev`, with passwordless sudo access.
Image preparation creates temporary billable instances and reusable images.
The authenticated image stores OpenCode authentication for disposable, single-user workspaces.
Membership in the VM's `docker` group grants root-equivalent access inside the VM.

## Configuration

Copy `config.example.json` to `config.json`, then set the cloud and SSH values.
Both `config.json` and `state.json` are ignored by Git because they contain machine-specific identifiers and
mutable local state.

## Prepare Images

Synchronize the reusable images after toolchain or setup changes:

```bash
bash scripts/orca-vm/yandex-cloud/setup.sh sync --confirm-cloud-changes
```

Synchronization rebuilds the base image and migrates OpenCode authentication from the newest ready
authenticated image.
When no authenticated image exists, it starts an instance for interactive authentication instead; complete
the printed login command, then run `auth-finish` as described below.

Individual setup phases remain available for maintenance and recovery.
Create only the base image:

```bash
bash scripts/orca-vm/yandex-cloud/setup.sh base --confirm-cloud-changes
```

Start an instance for interactive OpenCode authentication:

```bash
bash scripts/orca-vm/yandex-cloud/setup.sh auth-start --confirm-cloud-changes
```

The command prints the SSH command to run in an interactive terminal.
Complete OpenCode authentication there, then create the authenticated image:

```bash
bash scripts/orca-vm/yandex-cloud/setup.sh auth-finish --confirm-cloud-changes
```

When a new base image must retain authentication from the previous authenticated image, run:

```bash
bash scripts/orca-vm/yandex-cloud/setup.sh auth-migrate --confirm-cloud-changes
```

Remove obsolete base and authenticated images while retaining the IDs in current state:

```bash
bash scripts/orca-vm/yandex-cloud/setup.sh cleanup --confirm-cloud-changes
```

## Validation

Run the free static recipe doctor before creating a workspace:

```bash
orca-ide vm recipe doctor yandex-cloud --repo-path "$PWD" --json
```

On platforms where Orca provides a different session-specific command, use the executable selected by Orca
for that session instead of `orca-ide`.

The live doctor creates, validates, and destroys a billable workspace:

```bash
orca-ide vm recipe doctor yandex-cloud --repo-path "$PWD" --provision --json
```

## For AI Agents

- Never run `yc config list`; verify authentication with a scoped resource read that cannot return credentials.
- Keep cloud credentials, SSH private key contents, and OpenCode credentials out of `config.json` and
  `state.json`.
- Obtain explicit approval before running image setup or live provisioning because these commands create
  billable resources or persist OpenCode authentication.
- Run the static doctor before live validation.
- After a failed setup or live validation, verify that no temporary instance remains.
