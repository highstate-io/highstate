import type { SecretServiceImplementation } from "@highstate/api/secret.v1"
import type { Services } from "@highstate/backend"
import { authenticate } from "../shared"

export function createSecretService(services: Services): SecretServiceImplementation {
  return {
    async getSecretContent(_request, context) {
      const [_projectId] = await authenticate(services, context)

      // TODO: validate secret access

      throw new Error("Not implemented")

      // return {
      //   content,
      // }
    },
  }
}
