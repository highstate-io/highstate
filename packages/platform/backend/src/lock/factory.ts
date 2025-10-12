import type { LockBackend } from "./abstractions"
import { z } from "zod"
import { MemoryLockBackend } from "./memory"

export const lockBackendConfig = z.object({
  HIGHSTATE_LOCK_BACKEND_TYPE: z.enum(["memory"]).default("memory"),
})

export function createLockBackend(config: z.infer<typeof lockBackendConfig>): LockBackend {
  switch (config.HIGHSTATE_LOCK_BACKEND_TYPE) {
    case "memory": {
      return MemoryLockBackend.create()
    }
  }
}
