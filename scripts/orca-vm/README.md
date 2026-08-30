# Orca VM Environments

This guide covers shared lifecycle behavior, validation, and provider development for Highstate's optional
per-workspace VM environments.
The root [`orca.yaml`](../../orca.yaml) invokes provider lifecycle scripts through `run-provider.sh`, while
each provider script remains responsible for Orca's input and output contract.

## Script Boundaries

Shared host-side and VM-side behavior belongs in `shared/` so providers use the same result, SSH, toolchain,
and checkout contracts.
Cloud operations and provider configuration belong in their provider directory so shared behavior remains
independent of provider APIs.

The [Yandex Cloud guide](yandex-cloud/README.md) covers its prerequisites, configuration, image preparation,
validation, and safeguards.

## Workspace Lifecycle

A `provisioned-root` provider returns schema version 2 and prepares the primary checkout at the returned project
root.
Shared workspace setup checks out the exact commit supplied by Orca, initializes recursive submodules, and
verifies the shared toolchain.
It then installs locked dependencies, runs the repository preparation script, and builds every Nx project before
handoff.

Lifecycle scripts reserve standard output for Orca's final JSON result.
Progress and diagnostics go to standard error.
Suspend and destroy consume Orca's lifecycle payload on standard input.
Resume emits a fresh SSH recipe result because a resumed VM may receive a new public IP address.
Destroy treats an already absent instance as success.
The launcher preserves each lifecycle process's streams and records both in ignored
`logs/<provider>.<action>.log` files in this directory, replacing the previous invocation's log.

## Validation

Enter the repository development environment and run the script checks:

```bash
devenv shell
bunx --bun nx run orca-vm:check
```

Run each provider's static and live validation as documented in its provider guide.

## Add A Provider

Create `scripts/orca-vm/<provider>/` with `config.example.json`, `common.sh`, `create.sh`, and
`destroy.sh`.
Add `suspend.sh` and `resume.sh` together when the provider supports both operations.
Keep cloud operations in the provider directory and put reusable host-side or VM-side behavior in
`shared/`.

Add lifecycle commands through `run-provider.sh` to root `orca.yaml` and include the provider scripts in the
Orca VM Nx check.
Keep provider configuration and state in the provider directory as ignored `config.json` and
`state.json` files.
Reserve standard output for the recipe result, preserve cleanup traps around created resources, and run the
static doctor before live validation.
