# Yandex Cloud Orca Environments

The Yandex Cloud provider creates preemptible virtual machines from a reusable authenticated image.
The root [`orca.yaml`](../../../orca.yaml) connects Orca to the lifecycle scripts in this directory.
Shared lifecycle behavior is documented in the [Orca VM guide](../README.md).
The recipe uses `checkoutMode: provisioned-root` and returns the prepared primary checkout through a schema
version 2 SSH recipe result.
Workspace VM and boot disk names use the sanitized `orca-{workspaceName}` form.
Workspace names must therefore be unique among existing Yandex Cloud VMs.
Lifecycle actions use the recipe resource ID when Orca provides it and otherwise recover the instance from this
deterministic workspace name.
If workspace preparation fails or receives an interrupt, the create script synchronously deletes the new
instance before returning the failure.
Remote checkout and setup output is routed to standard error; standard output contains only the validated
recipe-result JSON object.
The shared launcher records lifecycle output as described in the [Orca VM guide](../README.md).

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

Scripts resolve a value in this order:

1. The corresponding environment variable
2. `state.json`
3. `config.json`
4. A built-in default

`state.json` stores non-secret mutable values that must survive between setup phases, including reusable image
IDs and temporary setup instance IDs.

The `opencodePermission` setting may be empty, `allow`, `ask`, or `deny`.
The `allow` value makes every OpenCode session in a provisioned VM run tools without approval prompts.

## Prepare Images

Synchronize the reusable images after toolchain or setup changes:

```bash
bash scripts/orca-vm/yandex-cloud/setup.sh sync --confirm-cloud-changes
```

Synchronization rebuilds the base image and migrates OpenCode authentication from the newest ready
authenticated image.
When no authenticated image exists, it starts an instance for interactive authentication instead; complete
the printed login command, then run `auth-finish` as described below.
It finishes by removing obsolete base and authenticated images while retaining the current state IDs.

Individual setup phases remain available for maintenance and recovery.
Create only the base image:

```bash
bash scripts/orca-vm/yandex-cloud/setup.sh base --confirm-cloud-changes
```

The base image provides Docker, OpenCode, and the shared development toolchain required before the repository's
devenv is available.
It also realizes the current working tree's `devenv.nix`, `devenv.yaml`, and `devenv.lock` in a dedicated cache
directory so their packages are already present when a workspace starts.
OpenCode enters `devenv shell` at repository roots so the agent and its child commands use project-pinned
tools.

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

Setup preserves cleanup traps around newly created resources.

## Validation

Run the free static recipe doctor before creating a workspace:

```bash
orca-ide vm recipe doctor yandex-cloud --repo-path "$PWD" --json
```

On platforms where Orca provides a different session-specific command, use the executable selected by Orca
for that session instead of `orca-ide`.
The static doctor checks recipe wiring and executable permissions without creating cloud resources.

The live doctor creates, validates, and destroys a billable workspace:

```bash
orca-ide vm recipe doctor yandex-cloud --repo-path "$PWD" --provision --json
```

Its provisioning transcript contains the lifecycle output when validation fails.

## For AI Agents

- Never run `yc config list`; verify authentication with a scoped resource read that cannot return credentials.
- Keep cloud credentials, SSH private key contents, and OpenCode credentials out of `config.json` and
  `state.json`.
- Obtain explicit approval before running image setup or live provisioning because these commands create
  billable resources or persist OpenCode authentication.
- Run the static doctor before live validation.
- After a failed setup or live validation, verify that no temporary instance remains.
