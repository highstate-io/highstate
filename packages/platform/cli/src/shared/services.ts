import type { Services } from "@highstate/backend"
import { logger } from "./logger"

let services: Promise<Services> | undefined

export function getBackendServices() {
  if (services) {
    return services
  }

  services = import("@highstate/backend").then(({ getSharedServices }) => {
    return getSharedServices({
      services: {
        logger: logger.child({}, { msgPrefix: "[backend] " }),
      },
    })
  })

  return services
}
