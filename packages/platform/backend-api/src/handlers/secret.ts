import type { ServiceImpl } from "@connectrpc/connect"
import type { SecretService } from "@highstate/api/v1"
import type { Services } from "@highstate/backend"
import { authenticateProject } from "../shared"

export function createSecretService(services: Services): ServiceImpl<typeof SecretService> {
  return {
    async getSecretContent(request, context) {
      await authenticateProject(services, request, context)

      // TODO: validate secret access

      throw new Error("Not implemented")

      // return {
      //   content,
      // }
    },
  }
}
