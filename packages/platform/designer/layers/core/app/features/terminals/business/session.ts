import type { TerminalSessionOutput } from "@highstate/backend/shared"
import { AttachAddon } from "@xterm/addon-attach"
import { WebLinksAddon, type ILinkProviderOptions } from "@xterm/addon-web-links"
import type { Terminal, ILinkHandler } from "@xterm/xterm"

export function useTerminalSession(projectId: string, sessionId: string) {
  const terminal = shallowRef<Terminal | null>(null)
  const session = shallowRef<TerminalSessionOutput | null>(null)
  const restartClicked = ref(false)

  const { $client } = useNuxtApp()
  const workspaceStore = useWorkspaceStore()

  const initialize = async (terminalValue: Terminal) => {
    terminal.value = terminalValue

    async function activateLink(event: MouseEvent, uri: string) {
      if (uri === "restart") {
        if (restartClicked.value) {
          return
        }

        restartClicked.value = true

        terminal.value!.writeln(">>> Restarting terminal session... <<<")

        const newSession = await $client.terminal.getOrCreateTerminalSession.mutate({
          projectId,
          terminalId: session.value!.terminalId,
        })

        workspaceStore.closeTerminalPanel(projectId, session.value!.id)
        workspaceStore.openTerminalPanel(projectId, newSession.id)
      } else if (isMacOS() ? event.metaKey : event.ctrlKey) {
        // Open link in a new tab
        window.open(uri, "_blank")
      }
    }

    const linkHandler: ILinkHandler = {
      activate: (event, text) => {
        activateLink(event, text)
      },
      hover: (_event, _text, _range) => {
        /* nothing, by default */
      },
      leave: (_event, _text, _range) => {
        /* nothing, by default */
      },
      allowNonHttpProtocols: true,
    }

    const webLinksAddon = new WebLinksAddon(activateLink, linkHandler as ILinkProviderOptions)
    terminal.value!.loadAddon(webLinksAddon)
    terminal.value!.options.linkHandler = linkHandler

    await loadSessionHistory()

    const { unsubscribe: stopWatchingSession } = $client.terminal.watchSession.subscribe(
      { projectId, sessionId },
      {
        onData(updatedSession) {
          session.value = updatedSession

          if (updatedSession.finishedAt) {
            const formattedDate = new Date(updatedSession.finishedAt).toLocaleString("en-US")
            const closedMessage = `>>> Terminal session finished at ${formattedDate} <<<`
            const coloredMessage = `\x1b[1m\x1b[33m${closedMessage}\x1b[0m` // Bold and yellow color

            const restartMessage = `>>> Click here to restart <<<`
            const linkedMessage = `\x1b]8;;restart\x1b\\${restartMessage}\x1b]8;;\x1b\\`

            terminal.value!.writeln("")
            terminal.value!.writeln(coloredMessage)
            terminal.value!.writeln(linkedMessage)

            stopWatchingSession()
          }
        },
      },
    )

    onDeactivated(stopWatchingSession)

    await until(session).not.toBeNull()

    if (!session.value!.finishedAt) {
      attachTerminal()
      terminal.value!.focus()
    }
  }

  const loadSessionHistory = async () => {
    const history = await $client.terminal.getSessionHistory.query({ projectId, sessionId })

    for (const chunk of history) {
      terminal.value!.write(chunk.content)
    }
  }

  const attachTerminal = () => {
    // TODO: extract base path to config
    const protocol = location.protocol === "https:" ? "wss" : "ws"
    const baseUrl = `${protocol}://${location.host}`

    const ws = new WebSocket(
      `${baseUrl}/api/projects/${projectId}/terminal-sessions/${sessionId}?screenSize=${terminal.value!.cols}x${terminal.value!.rows}`,
    )

    const attachAddon = new AttachAddon(ws)
    terminal.value!.loadAddon(attachAddon)

    onDeactivated(() => ws.close())
  }

  return {
    initialize,
    session,
  }
}
