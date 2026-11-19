import { randomBytes } from "node:crypto"
import { getHostedAuthConfig, isHostedAuth } from "./auth-config"

type PanelSession = {
  projectId: string
  panelId: string
  workerInstanceId: string
  expiresAt: number
  designerSessionToken?: string
}

const launchTickets = new Map<string, PanelSession>()
const sessions = new Map<string, PanelSession>()
const launchTicketLifetime = 30_000
const sessionLifetime = 8 * 60 * 60 * 1_000

export function createPanelLaunchTicket(
  projectId: string,
  panelId: string,
  workerInstanceId: string,
  designerSessionToken?: string,
): string {
  const ticket = randomBytes(32).toString("base64url")

  launchTickets.set(ticket, {
    projectId,
    panelId,
    workerInstanceId,
    designerSessionToken,
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
    if (!isHostedAuth() && session.panelId === panelId) {
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

  if (isHostedAuth()) {
    const suffix = `.panels.${new URL(getHostedAuthConfig().publicUrl).hostname}`
    if (!hostname?.endsWith(suffix)) {
      return undefined
    }

    const labels = hostname.slice(0, -suffix.length).split(".")
    return labels.every(label => /^[a-z0-9-]+$/.test(label)) &&
      /^[a-z0-9]+$/.test(labels.at(-1) ?? "")
      ? labels.at(-1)
      : undefined
  }

  const match = hostname?.match(
    /^(?:[a-z0-9-]+\.)*(?<panelId>[a-z0-9]+)\.panels\.highstate\.localhost$/,
  )

  return match?.groups?.panelId
}

export function isNestedPanelHost(host: string | undefined, panelId: string): boolean {
  const hostname = host?.split(":")[0]

  if (isHostedAuth()) {
    return (
      hostname?.endsWith(
        `.${panelId}.panels.${new URL(getHostedAuthConfig().publicUrl).hostname}`,
      ) ?? false
    )
  }

  return hostname?.endsWith(`.${panelId}.panels.highstate.localhost`) ?? false
}
