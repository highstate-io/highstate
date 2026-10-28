import type { Services } from "@highstate/backend"
import { resolveHumanProjectContext } from "@highstate/backend"
import { ensureLocalBackendUser } from "../authentication"
import { isHostedAuth } from "./auth-config"
import { initializeHostedProjectAuth } from "./auth-initialization"
import { authenticateHostedSession, sessionTokenFromHeaders } from "./hosted-session"

export async function authenticateProjectHeaders(
  services: Services,
  headers: Headers,
  projectId: string,
) {
  if (isHostedAuth()) {
    const identity = await authenticateHostedSession(services, sessionTokenFromHeaders(headers))
    await initializeHostedProjectAuth(services, projectId)
    return await resolveHumanProjectContext(services.database, identity, projectId)
  }

  const local = await ensureLocalBackendUser(services)
  return await resolveHumanProjectContext(
    services.database,
    { id: local.id, type: "local", meta: { title: local.username }, groups: [] },
    projectId,
    true,
  )
}
