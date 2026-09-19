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

Open the printed frontend URL after both listeners have started.
An HTTP request to the root of the event port returns `404` because that port only serves the WebSocket endpoint.

## Orca Remote Environments

Use an Orca-managed terminal in the remote worktree so Orca can route both Designer ports to its browser.
Create the terminal first and read its rendered screen until the automatic development shell reaches a prompt.
Sending the command through `terminal create --command`, or through `terminal send` before the prompt appears,
can display the command without executing it.

```bash
orca terminal create --worktree active --title Designer --json
orca terminal read --terminal <terminal-handle> --screen --json
orca terminal send \
  --terminal <terminal-handle> \
  --text 'HIGHSTATE_ENCRYPTION_ENABLED=false bun run --bun --filter @highstate/designer dev' \
  --enter \
  --json
```

The default accumulated-output read does not reproduce terminal repainting and can appear stuck on devenv's
startup progress after the command is running.

Keep that terminal running and open Designer in Orca's embedded browser:

```bash
orca tab create --url <printed-frontend-url> --json
```

Reload an existing Designer tab after restarting the server so its WebSocket client reconnects to the assigned
event port.
Successful verification includes a loaded project and no `Bun is not defined`, tRPC connection, or event-port
WebSocket errors in the browser console.

## For AI Agents

When the `orca-cli` skill is available, load it before using Orca and follow its executable-resolution rules
instead of assuming that the command is named `orca`.
