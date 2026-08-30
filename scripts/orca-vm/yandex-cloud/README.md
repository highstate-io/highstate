# Yandex Cloud Orca Environments

The Yandex Cloud provider creates preemptible virtual machines from one reusable base image. Credentials and
user configuration are copied from the local machine to each new VM over SSH and never stored in that image.
Shared harness configuration is documented in the [Orca VM guide](../README.md).

## Prerequisites

The provider requires Bash, `yc`, `jq`, `ssh`, an SSH key pair, and an authenticated Yandex Cloud CLI.
Cloud-init creates the configured SSH user, which defaults to `dev`, with passwordless sudo access. Image
preparation creates temporary billable instances and reusable images. Membership in the VM's `docker` group
grants root-equivalent access inside the VM.

## Configuration

Copy `../config.example.json` to `../config.json` for shared files and harnesses. Copy `config.example.json` to
`config.json` for Yandex Cloud, SSH, machine, and project settings. Both local configuration files and
`state.json` are ignored by Git.

## Prepare The Base Image

Build and retain a base image after changing shared setup scripts or harness enablement:

```bash
bash scripts/orca-vm/yandex-cloud/setup.sh sync --confirm-cloud-changes
```

The image contains the shared toolchain and only the enabled harness executables. It has no user credentials or
configuration. Its labels contain a contract version and setup fingerprint. Workspace creation rejects missing,
unready, legacy, or mismatched images before creating a billable VM.

Build only the new image without a separate cleanup pass:

```bash
bash scripts/orca-vm/yandex-cloud/setup.sh base --confirm-cloud-changes
```

Delete obsolete base images and all legacy authenticated images:

```bash
bash scripts/orca-vm/yandex-cloud/setup.sh cleanup --confirm-cloud-changes
```

## Validation

Run the free static recipe doctor before creating a workspace:

```bash
orca-ide vm recipe doctor yandex-cloud --repo-path "$PWD" --json
```

The live doctor creates, validates, and destroys a billable workspace. It also transfers the credentials selected
in the shared configuration:

```bash
orca-ide vm recipe doctor yandex-cloud --repo-path "$PWD" --provision --json
```

## For AI Agents

- Never run `yc config list`; verify authentication with a scoped resource read that cannot return credentials.
- Never print shared configuration contents, SSH private keys, OpenCode credentials, or copied file contents.
- Obtain explicit approval before image setup or live provisioning because these commands create billable
  resources and live provisioning transfers real credentials.
- Run the static doctor before live validation.
- After a failed setup or live validation, verify that no temporary instance remains.
