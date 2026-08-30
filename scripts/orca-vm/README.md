# Orca VM Environments

This directory contains the shared host-side and VM-side behavior for Highstate's optional per-workspace VM
environments.

## Shared Configuration

Copy `config.example.json` to the ignored `config.json`. This shared file controls the local files and coding
harness data copied to every VM. Provider configuration remains in each provider directory and contains only
provider, SSH, and machine settings.

Each `files` entry names a regular file relative to the local and remote home directories. Its `mode` must be a
four-digit octal mode. The scripts reject absolute paths, traversal, symlinks, missing files, duplicate paths,
and invalid modes before provisioning.

`skills` controls copies from `~/.agents/skills`:

- `false` copies no skills and is the default.
- `true` copies every local skill.
- An array copies only the named skills.

OpenCode is the only supported harness. `opencode.enabled` controls whether OpenCode is installed in the base
image and whether local OpenCode data is copied when a VM is created. Changing this value invalidates the base
image and requires a rebuild.

`opencode.providers` is `true` for all credentials or an array of provider IDs. The array filters both
`auth.json` and provider configuration. `opencode.mcp` is `false`, `true`, or an array of MCP names and filters
both MCP definitions and `mcp-auth.json`. `opencode.defaultPermission` is empty, `allow`, `ask`, or `deny`.

Credentials are streamed directly from the local machine over SSH after VM creation. They are not included in
cloud-init, command-line arguments, logs, or reusable images.

## Validation

Run the script checks from the repository development environment:

```bash
bunx --bun nx run orca-vm:check
```

The [Yandex Cloud guide](yandex-cloud/README.md) documents provider setup and live validation.

## Add A Provider

Create `scripts/orca-vm/<provider>/` with `config.example.json`, `common.sh`, `create.sh`, and `destroy.sh`.
Add `suspend.sh` and `resume.sh` together when the provider supports both operations. Reuse `shared/config.sh`
for local validation, base contracts, and credential copying.

Reserve standard output for the recipe result, preserve cleanup traps around created resources, and run the
static doctor before live validation.
