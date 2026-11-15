import type { AccessController } from "../utils/access-control"

declare module "#app" {
  interface NuxtApp {
    $access: AccessController
  }
}
