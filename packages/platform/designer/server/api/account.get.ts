import { isHostedAuth } from "../utils/auth-config"

export default defineEventHandler(event => {
  setHeader(event, "Cache-Control", "no-store")

  if (!isHostedAuth()) {
    return {
      username: "Local user",
      title: "Local user",
      avatarUrl: null,
      email: null,
      id: null,
      type: "local",
    }
  }

  const identity = event.context.designerIdentity
  if (!identity) {
    throw createError({ statusCode: 401, statusMessage: "Authentication required" })
  }

  return {
    username: identity.meta.username ?? identity.meta.title,
    title: identity.meta.title,
    avatarUrl: identity.meta.avatarUrl ?? null,
    email: identity.meta.email ?? null,
    id: identity.id,
    type: identity.type,
  }
})
