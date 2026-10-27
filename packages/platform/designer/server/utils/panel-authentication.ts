import {
  getSharedServices,
  requireProjectPermission,
  resolveHumanProjectContext,
} from "@highstate/backend"
import { isHostedAuth } from "./auth-config"
import { authenticateHostedSession } from "./hosted-session"

export async function authorizePanelSession(session: {
  projectId: string
  panelId: string
  designerSessionToken?: string
  expiresAt: number
}): Promise<void> {
  if (!isHostedAuth()) return
  if (session.expiresAt <= Date.now()) throw new Error("Panel session expired")
  const services = await getSharedServices()
  const identity = await authenticateHostedSession(services, session.designerSessionToken)
  const context = await resolveHumanProjectContext(services.database, identity, session.projectId)
  requireProjectPermission(context, "panel.get", { resourceId: session.panelId })
}
