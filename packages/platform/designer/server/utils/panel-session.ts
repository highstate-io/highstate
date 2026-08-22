import { randomBytes } from "node:crypto"

type PanelSession = {
  projectId: string
  panelId: string
  workerInstanceId: string
  expiresAt: number
}

const launchTickets = new Map<string, PanelSession>()
const sessions = new Map<string, PanelSession>()
const launchTicketLifetime = 30_000
const sessionLifetime = 8 * 60 * 60 * 1_000

export function createPanelLaunchTicket(
  projectId: string,
  panelId: string,
  workerInstanceId: string,
): string {
  const ticket = randomBytes(32).toString("base64url")
  launchTickets.set(ticket, {
    projectId,
    panelId,
    workerInstanceId,
    expiresAt: Date.now() + launchTicketLifetime,
  })

  return ticket
}

export function exchangePanelLaunchTicket(ticket: string, panelId: string): string | undefined {
  const launch = launchTickets.get(ticket)
  launchTickets.delete(ticket)
  if (!launch || launch.panelId !== panelId || launch.expiresAt < Date.now()) {
    return undefined
  }

  for (const [sessionId, session] of sessions) {
    if (session.panelId === panelId) {
      sessions.delete(sessionId)
    }
  }

  const sessionId = randomBytes(32).toString("base64url")
  sessions.set(sessionId, {
    ...launch,
    expiresAt: Date.now() + sessionLifetime,
  })

  return sessionId
}

export function getPanelSession(sessionId: string, panelId: string): PanelSession | undefined {
  const session = sessions.get(sessionId)
  if (!session || session.panelId !== panelId || session.expiresAt < Date.now()) {
    sessions.delete(sessionId)
    return undefined
  }

  return session
}

export function getActivePanelSession(panelId: string): PanelSession | undefined {
  for (const [sessionId, session] of sessions) {
    if (session.expiresAt < Date.now()) {
      sessions.delete(sessionId)
      continue
    }
    if (session.panelId === panelId) {
      return session
    }
  }

  return undefined
}

export function getPanelIdFromHost(host: string | undefined): string | undefined {
  const hostname = host?.split(":")[0]
  const match = hostname?.match(
    /^(?:[a-z0-9-]+\.)*(?<panelId>[a-z0-9]+)\.panels\.highstate\.localhost$/,
  )

  return match?.groups?.panelId
}

export function isNestedPanelHost(host: string | undefined, panelId: string): boolean {
  const hostname = host?.split(":")[0]

  return hostname?.endsWith(`.${panelId}.panels.highstate.localhost`) ?? false
}
