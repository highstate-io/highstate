import type { Services } from "@highstate/backend"
import { getLocalUserId } from "@highstate/backend"
import { userInfo } from "node:os"

export type LocalUser = {
  id: string
  username: string
}

export function getLocalUser(): LocalUser {
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
