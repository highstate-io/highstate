# Designer Development

The Designer development server requires the Bun runtime.
Its Nitro plugin starts a dedicated tRPC event server with `Bun.serve`, so running Nuxt under Node leaves the
frontend available while event requests fail with `Bun is not defined`.

Local development normally disables encryption so it does not depend on an operating-system secret service.
From the workspace root, start Designer with:

```bash
HIGHSTATE_ENCRYPTION_ENABLED=false bun run --bun --filter @highstate/designer dev
```

Designer prefers port `3000` for its frontend and port `3002` for its event WebSocket server.
The development command assigns free ports when either preferred port is already in use and prints both assigned
endpoints before starting Nuxt.
Set `NITRO_PORT` and `NUXT_PUBLIC_EVENTS_PORT` to override either port.
The two ports must be different.

Set `HIGHSTATE_CODEBASE_PATH` to a separate directory to isolate project and backend data during testing.
Set `HIGHSTATE_DESIGNER_WORKER_SOCKET_PATH` to a unique socket path when running multiple Designer backends
under the same OS account.

Open the printed frontend URL after both listeners have started.
An HTTP request to the root of the event port returns `404` because that port only serves the WebSocket endpoint.

## Permission-Aware Interfaces

Every access rejection must disable the corresponding functionality and visibly explain why it is unavailable.
Prefer keeping the control visible and disabled, with a tooltip on hover over the disabled control itself that
identifies the missing permission.
Put the required permission on a separate line from the explanation in notices and tooltips.
Do not add a separate information icon for these permission tooltips.
Prefer placing access-denied tooltips to the right of the control; use another placement when space or layout
makes that inappropriate.
Apply this pattern to buttons, menu items, editors, drag-and-drop, keyboard shortcuts, and other equivalent entry points.
Client-side permission hints are advisory; business services must still authorize every request.

Distinguish denied reads from empty collections, missing resources, loading, and transport failures.
Show a persistent access explanation in the affected view instead of an empty state, spinner, console-only error,
or toast alone.
Do not duplicate the same restriction in both a local explanation and a corner notice. Use corner notices only
when the restriction cannot be expressed by an inline explanation or a disabled control's tooltip.
Handle authorization failures from queries, mutations, subscriptions, downloads, and embedded content.
Keep access information synchronized with the server while the interface is open, without manual refresh buttons.
A revoked session must stop protected interaction and offer sign-in.
Clear protected cached data after access is lost and preserve non-protected navigation and account access.

Verify each affected interaction with allowed and denied identities, including restricted resource grants and live revocation.
Capture the denied view and its explanation in browser screenshots, with a review index identifying the fixture and action.

## Browser Testing

Use the [end-to-end testing harness](end-to-end-testing.md) to start an isolated local Designer for manual or
agent-driven browser testing. Automated tests and browser tools can inspect the same server and database.
