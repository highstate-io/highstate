import type { Services } from "@highstate/backend"
import { logger } from "./logger"

let services: Promise<Services> | undefined
let disposePromise: Promise<void> | undefined

export function getBackendServices(): Promise<Services> {
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

export function disposeServices(): Promise<void> {
  if (!services) {
    return Promise.resolve()
  }

  if (disposePromise) {
    return disposePromise
  }

  disposePromise = import("@highstate/backend")
    //
    .then(({ disposeServices }) => services!.then(s => disposeServices(s)))

  return disposePromise
}
