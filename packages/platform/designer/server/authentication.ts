import type { Services } from "@highstate/backend"
import { userInfo } from "node:os"
import { getLocalUserId } from "@highstate/backend"
import { isHostedAuth } from "./utils/auth-config"

export type LocalUser = {
  id: string
  username: string
}

export function getLocalUser(): LocalUser {
  if (isHostedAuth()) {
    throw new Error("Local authentication is disabled in hosted mode")
  }

  const username = userInfo().username

  return { id: getLocalUserId(username), username }
}

export async function ensureLocalBackendUser(services: Services): Promise<LocalUser> {
  const user = getLocalUser()

  await services.database.backend.user.upsert({
    where: { id: user.id },
    create: {
      id: user.id,
      type: "local",
      meta: { title: user.username, username: user.username },
    },
    update: { type: "local", meta: { title: user.username, username: user.username } },
  })

  return user
}
