import type { DesignerIdentity, Services } from "@highstate/backend"
import { designerIdentitySchema } from "@highstate/backend"
import { createHash, randomBytes } from "node:crypto"
import { getHostedAuthConfig } from "./auth-config"

export const sessionCookie = "__Host-highstate-session"
export const loginCookie = "__Host-highstate-login"
export const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" }
export const opaqueToken = () => randomBytes(32).toString("base64url")
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

export function sessionTokenFromHeaders(headers: Headers): string | undefined {
  return headers
    .get("cookie")
    ?.split(";")
    .map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith(`${sessionCookie}=`))
    ?.slice(sessionCookie.length + 1)
}

export async function authenticateHostedSession(
  services: Services,
  token: string | undefined,
): Promise<DesignerIdentity> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Authentication required")
  const session = await services.database.backend.designerSession.findUnique({
    where: { tokenHash: hashToken(token) },
  })
  if (!session || session.revokedAt || session.expiresAt <= new Date())
    throw new Error("Session expired or revoked")
  const identity = designerIdentitySchema.parse(session.identity)
  if (identity.type === "local" || identity.id !== session.userId)
    throw new Error("Invalid hosted session")
  return identity
}

export async function createHostedSession(
  services: Services,
  identity: DesignerIdentity,
): Promise<string> {
  identity = designerIdentitySchema.parse(identity)
  if (identity.type === "local") throw new Error("Invalid hosted identity")
  const config = getHostedAuthConfig()
  const token = opaqueToken()
  await services.database.backend.user.upsert({
    where: { id: identity.id },
    create: { id: identity.id, type: identity.type, meta: identity.meta },
    update: { type: identity.type, meta: identity.meta },
  })
  for (const group of identity.groups)
    await services.database.backend.userGroup.upsert({
      where: { id: group.id },
      create: { id: group.id, meta: { title: group.title } },
      update: { meta: { title: group.title } },
    })
  // refresh claims for existing browser sessions as well as the new login
  await services.database.backend.designerSession.updateMany({
    where: { userId: identity.id, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { identity },
  })
  await services.database.backend.designerSession.create({
    data: {
      tokenHash: hashToken(token),
      userId: identity.id,
      identity,
      expiresAt: new Date(Date.now() + config.sessionLifetimeSeconds * 1000),
    },
  })
  return token
}

export function requireHostedOrigin(headers: Headers): void {
  if (headers.get("origin") !== new URL(getHostedAuthConfig().publicUrl).origin)
    throw new Error("Invalid request origin")
}

/** Revalidates durable revocation even when no messages are flowing. */
export function monitorHostedSession(
  services: Services,
  token: string | undefined,
  close: () => void,
  validate?: () => Promise<unknown>,
): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    void (validate ? validate() : authenticateHostedSession(services, token)).catch(close)
  }, 5000)
  timer.unref?.()
  return timer
}
