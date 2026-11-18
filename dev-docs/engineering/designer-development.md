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

## Browser Testing

Use the [end-to-end testing harness](end-to-end-testing.md) to start an isolated local Designer for manual or
agent-driven browser testing. Automated tests and browser tools can inspect the same server and database.
