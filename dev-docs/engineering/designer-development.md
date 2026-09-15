# Designer Development

The Designer development server requires the Bun runtime.
Its Nitro plugin starts a dedicated tRPC event server with `Bun.serve`, so running Nuxt under Node leaves the
frontend available while event requests fail with `Bun is not defined`.

Local development normally disables encryption so it does not depend on an operating-system secret service.
From the workspace root, start Designer with:

```bash
HIGHSTATE_ENCRYPTION_ENABLED=false bun run --bun --filter @highstate/designer dev
```

Designer serves its frontend on port `3000` and its event WebSocket server on port `3002`.
Open `http://highstate.localhost:3000/` after both listeners have started.
An HTTP request to the root of port `3002` returns `404` because that port only serves the WebSocket endpoint.

## Orca Remote Environments

Use an Orca-managed terminal in the remote worktree so Orca can route both Designer ports to its browser.
Create the terminal first and wait for its development shell to reach a prompt before sending the launch command.
Sending a command while the automatic development shell is still initializing can display the command without
executing it.

```bash
orca terminal create --worktree active --title Designer --json
orca terminal read --terminal <terminal-handle> --json
orca terminal send \
  --terminal <terminal-handle> \
  --text 'HIGHSTATE_ENCRYPTION_ENABLED=false bun run --bun --filter @highstate/designer dev' \
  --enter \
  --json
```

Keep that terminal running and open Designer in Orca's embedded browser:

```bash
orca tab create --url http://highstate.localhost:3000/ --json
```

Reload an existing Designer tab after restarting the server so its WebSocket client reconnects to port `3002`.
Successful verification includes a loaded project and no `Bun is not defined`, tRPC connection, or port `3002`
WebSocket errors in the browser console.

## For AI Agents

When the `orca-cli` skill is available, load it before using Orca and follow its executable-resolution rules
instead of assuming that the command is named `orca`.
