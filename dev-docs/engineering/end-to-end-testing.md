# End-to-End Testing

The private [`@highstate/e2e` package](../../packages/e2e/package.json) owns cross-package lifecycle and runtime checks.
These checks use real resources and complement the focused tests described in [Testing](testing.md).

## Lifecycle Verification

The lifecycle command requires Bun, Node.js, Docker, and OpenSSL on `PATH`, with a reachable Docker daemon.
Install workspace dependencies with `bun install --frozen-lockfile` and bootstrap the CLI with
`scripts/bootstrap-cli.sh` when preparing a fresh checkout.

From the workspace root, run:

```sh
bun run --bun --filter @highstate/e2e test:e2e
```

The package entry point builds the required products and runner image before running the lifecycle scenario.
It also interrupts in-flight Pulumi operations to verify cancellation and backend restart recovery, then upgrades
databases populated by the published previous backend release through normal startup and public API access.
Use this command to verify changes that cross the backend, API, CLI, unit execution, or runner boundary.
Run `bun run ci:verify` alongside it for affected-package verification against `origin/main`.

## Runtime Conformance

Select the runtime explicitly when checking container runtime changes:

```sh
HIGHSTATE_E2E_RUNTIME=local-docker bun run --bun --filter @highstate/e2e test:conformance
HIGHSTATE_E2E_RUNTIME=remote-docker bun run --bun --filter @highstate/e2e test:conformance
HIGHSTATE_E2E_RUNTIME=kubernetes bun run --bun --filter @highstate/e2e test:conformance
```

Run the affected runtime command after changing its implementation.
Run all three after changing a shared runtime contract.
Conformance imports built backend products; prepare them with `bunx --bun nx run @highstate/backend:build`.
Remote Docker provisions a separate privileged Docker-in-Docker daemon through the host Docker engine.
Kubernetes requires `kind` and `kubectl` on `PATH` and creates its own disposable cluster and namespace.
Missing prerequisites are failures rather than reasons to skip resource-backed assertions.

Run development tools directly first.
If a tool is unavailable, retry the same command through `devenv shell -q -- <command>`.

## Continuous Integration and Evidence

Verify the production Designer in Chromium with:

```sh
bun packages/e2e/src/browser/run.ts
```

Install its browser dependency first with
`bun run --cwd packages/e2e --bun playwright install --with-deps chromium`.

The [E2E workflow](../../.github/workflows/e2e.yaml) runs Docker lifecycle verification on every pull request.
Remote Docker and Kubernetes conformance also run for affected paths, nightly, and on manual dispatch.
The Kubernetes job uses a disposable kind cluster.

Each resource-backed job uploads sanitized evidence from `.artifacts/e2e` even when verification fails.
Private keys, credentials, kubeconfig files, and databases are not publishable evidence.
Use the uploaded evidence to diagnose failures; keep private runtime state outside the evidence directory.
