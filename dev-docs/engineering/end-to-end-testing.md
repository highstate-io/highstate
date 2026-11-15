# End-to-End Testing

The private [`@highstate/e2e` package](../../packages/e2e/package.json) verifies assembled products through real browser interactions.
Its production Designer runs with disposable storage and does not depend on an existing development server or user database.

Install workspace dependencies and prepare the CLI with `bun install --frozen-lockfile` and `bun run ci:prepare`.
Install Chromium with `bun run --cwd packages/e2e --bun playwright install --with-deps chromium`, then run:

```sh
bun run --bun --filter @highstate/e2e test:e2e
```

The command builds the production Designer and verifies settings, project creation, navigation, and event connections
in Chromium.
For iteration after a successful build, `bun packages/e2e/src/browser/smoke.ts` reuses that production output.
The fixture removes its process and database when the scenario completes or fails.

The [E2E workflow](../../.github/workflows/e2e.yaml) runs on pull requests and manual dispatches.
It uploads sanitized screenshots and JSON evidence from `.artifacts/e2e` even when verification fails.
Private keys, credentials, and databases are not publishable evidence.
