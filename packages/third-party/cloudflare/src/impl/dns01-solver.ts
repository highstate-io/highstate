import { dns01SolverMediator, Secret } from "@highstate/k8s"
import { cloudflare } from "@highstate/library"

export const createCloudflareDns01Solver = dns01SolverMediator.implement(
  cloudflare.providerDataSchema,
  ({ namespace }, data) => {
    const secret = Secret.create(`cloudflare.${data.zoneId}`, {
      namespace,

      stringData: {
        apiToken: data.apiToken,
      },
    })

    return {
      cloudflare: {
        apiTokenSecretRef: {
          name: secret.metadata.name,
          key: "apiToken",
        },
      },
    }
  },
)
