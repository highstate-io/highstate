# Orca VM Environments

This guide covers validation and provider development for Highstate's optional per-workspace VM environments.

## Script Boundaries

Shared host-side and VM-side behavior belongs in `shared/` so providers use the same result, SSH, toolchain,
and checkout contracts.
Cloud operations and provider configuration belong in their provider directory so shared behavior remains
independent of provider APIs.

The [Yandex Cloud guide](yandex-cloud/README.md) covers its prerequisites, configuration, image preparation,
validation, and safeguards.

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
Reserve standard output for the recipe result, preserve cleanup traps around created resources, and run the
static doctor before live validation.
