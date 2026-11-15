# End-to-End Testing

The private [`@highstate/e2e` package](../../packages/e2e/package.json) verifies assembled products through API,
CLI, and browser scenarios.
Shared harness modules own isolated storage, process lifecycle, fixtures, cleanup, and evidence.
Test clients use those modules without requiring browser automation.

Install workspace dependencies and prepare the CLI with `bun install --frozen-lockfile` and `bun run ci:prepare`.
Install Pulumi CLI version `3.232.0` or newer for Designer-backed suites.
The harness links only its executable into the isolated home, keeping credentials and state separate and avoiding
a fresh toolchain download during each backend startup.
Set `HIGHSTATE_E2E_PULUMI_PATH` when the executable is neither on `PATH` nor in `~/.pulumi/bin`.
Install Chromium with `bun run --cwd packages/e2e --bun playwright install --with-deps chromium` for browser
scenarios, then run:

```sh
bun run --bun --filter @highstate/e2e test:e2e
```

The command builds production output, verifies CLI execution and API project lifecycle, then checks settings,
project creation, navigation, and event connections in Chromium.
Use `test:api`, `test:cli`, or `test:browser` instead of `test:e2e` to run only one client suite.
API and CLI suites do not launch Chromium or require its installation.
For iteration after a successful build, `bun packages/e2e/src/browser/smoke.ts` reuses that production output.
The fixture removes its process and database when the scenario completes or fails.

The [E2E workflow](../../.github/workflows/e2e.yaml) runs on pull requests and manual dispatches.
It uploads sanitized screenshots and JSON evidence from `.artifacts/e2e` even when verification fails.
Private keys, credentials, and databases are not publishable evidence.

## CLI Interaction

`src/harness/cli.ts` exposes `startCli(environment, args)` for the built Highstate CLI.
Pass the shared Designer environment to use its working directory, isolated home, configuration, and codebase.
The returned session supports writing stdin, waiting for output, closing stdin, inspecting stdout and stderr,
checking the exit code, and stopping the process.
Commands execute directly without shell interpolation and have a bounded execution timeout.
These are piped sessions, not terminal emulators; prompts that require a TTY need terminal-based verification.
Always stop sessions in a `finally` block before cleaning up their environment.

## Interactive Agent Workflows

`bun run --bun --filter @highstate/e2e inspect` uses the same isolated Designer launcher and fixture helpers as
the automated checks, creates two unlocked projects, and prints its URL and private inspection manifest.
Open that URL directly with the OpenCode browser or another browser automation tool.
The harness remains active with the same database until interrupted; agents do not need another server or fixture setup.

Inspection defaults to development mode and uses the repository's Bun Designer dev launcher with isolated frontend
and event ports.
Set `HIGHSTATE_E2E_MODE=production` to inspect the already-built production Designer instead.

To inspect the exact state of a successful or failed automated run, set `HIGHSTATE_E2E_KEEP_ALIVE=1` when running
`test:e2e`, `test:api`, or `test:browser`.
The test report is followed by an inspection URL, and cleanup waits until the agent interrupts the harness.
Fixture identities and databases remain private and must not be uploaded as CI evidence.
