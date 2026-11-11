# Production Designer browser smoke

Install workspace dependencies and Chromium with its system libraries, then run from the workspace root:

```sh
bun install --frozen-lockfile
bun run --cwd packages/e2e --bun playwright install --with-deps chromium
bun packages/e2e/src/browser/run.ts
```

The e2e package requires `@playwright/test` as a development dependency.
`run.ts` builds Designer and its workspace dependencies through Nx before running the smoke.
To rerun against an already built checkout, use `bun packages/e2e/src/browser/smoke.ts`.

The smoke starts `.output/server/index.mjs` under Bun on two disposable loopback ports.
Its temporary codebase, home, backend database, and project databases are independent of local Designer state.
Inherited Highstate, Nuxt, Nitro, database, and dotenv overrides are removed from the server environment.
The initial library selection is explicitly `[]`, and local library builds are disabled.
The browser uses a fresh context; existing Designer servers are never reused.

Settings create, update, delete, and reload checks use the actual UI and backend.
The smoke also creates a project through the UI, checks the empty package selection and add-package controls,
checks the empty-project auto-update guard, and opens project operation history with a real collection query.
It does not execute a unit or build a package image; runtime execution is covered by the lifecycle suite.
Browser runtime, console, HTTP, and event socket errors fail the run.
Independent package and operation checks continue after a failure so the result identifies each affected surface.

Sanitized step results, durations, and fault categories are written to `.artifacts/e2e/browser-*/result.json`.
Raw server output, response bodies, traces, screenshots, credentials, and databases are not published as evidence.
The production process and temporary state are removed on completion, including assertion failures.
