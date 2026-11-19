# End-to-End Testing

The private [`@highstate/e2e` package](../../packages/e2e/package.json) verifies assembled products through API,
CLI, and browser scenarios.
Shared harness modules own isolated storage, process lifecycle, fixtures, cleanup, and evidence.
Test clients use those modules without requiring browser automation.
Each Designer receives independent frontend and event ports and a Unix worker socket in its private directory.
The harness prevents environment overrides from reusing another backend's socket and removes its own socket during cleanup.

Install workspace dependencies and prepare the CLI with `bun install --frozen-lockfile` and `bun run ci:prepare`.
Install Pulumi CLI version `3.232.0` or newer for Designer-backed suites.
The harness links only its executable into the isolated home, keeping credentials and state separate and avoiding
a fresh toolchain download during each backend startup.
Set `HIGHSTATE_E2E_PULUMI_PATH` when the executable is neither on `PATH` nor in `~/.pulumi/bin`.
Install Chromium with `bun run --cwd packages/e2e --bun playwright install --with-deps chromium` for browser scenarios.
Set `CHROMIUM_PATH` to use an existing Chromium executable from a development toolchain instead of the downloaded browser.
Then run:

```sh
bun run --bun --filter @highstate/e2e test:e2e
```

The command builds production output, verifies CLI execution and API project lifecycle, then checks settings,
project creation, navigation, and event connections in Chromium.
The browser suite also runs hosted authentication against a disposable OIDC provider, then checks permission-aware
settings, known-user directories, multi-role assignment, scoped grants, live revocation, reconnects, and session revocation.
These hosted scenarios use development mode with explicitly enabled loopback HTTP; production TLS checks remain enabled.
Use `test:api`, `test:cli`, or `test:browser` instead of `test:e2e` to run only one client suite.
API and CLI suites do not launch Chromium or require its installation.
For iteration after a successful build, `bun packages/e2e/src/browser/smoke.ts` reuses that production output.
The fixture removes its process and database when the scenario completes or fails.
Hosted browser checks require Docker for a disposable PostgreSQL container; API and CLI checks do not require it.

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

Use `bun run --bun --filter @highstate/e2e inspect:auth` for an isolated hosted Designer with the same OIDC fixture
as the authorization scenarios.
Its sign-in page offers administrator, reader, and outsider test identities.
Only the administrator has initial permissions; assign roles through the UI to explore the other identities.
Do not start separate authentication servers or reuse a developer's database for these checks.

Inspection defaults to development mode and uses the repository's Bun Designer dev launcher with isolated frontend
and event ports.
Set `HIGHSTATE_E2E_MODE=production` to inspect the already-built production Designer instead.

To inspect the exact state of a successful or failed automated run, set `HIGHSTATE_E2E_KEEP_ALIVE=1` when running
`test:e2e`, `test:api`, or `test:browser`.
The test report is followed by an inspection URL, and cleanup waits until the agent interrupts the harness.
Fixture identities and databases remain private and must not be uploaded as CI evidence.
