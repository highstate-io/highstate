import { gatewayClientAuthMediator } from "@highstate/common"
import { z } from "@highstate/contract"
import { gateway as envoyGateway } from "@highstate/envoy-gateway-crds"
import { Gateway, getProviderAsync, Secret } from "@highstate/k8s"
import { toDnsNameMatcher } from "./gateway-client-auth-matchers"

export const createGatewayClientAuth = gatewayClientAuthMediator.implement(
  z.object({}),
  async ({ name, args, gateway, opts }) => {
    if (!(gateway instanceof Gateway)) {
      throw new Error("Envoy Gateway client authentication requires a Kubernetes Gateway resource.")
    }

    const provider = await getProviderAsync(gateway.cluster)

    const caSecret = Secret.create(
      name,
      {
        namespace: gateway.namespace,
        stringData: {
          "ca.crt": `${args.ca.join("\n")}\n`,
        },
      },
      { ...opts, parent: gateway },
    )

    const policy = new envoyGateway.v1alpha1.ClientTrafficPolicy(
      name,
      {
        metadata: {
          name,
          namespace: gateway.namespace.metadata.name,
        },
        spec: {
          targetRef: {
            group: "gateway.networking.k8s.io",
            kind: "Gateway",
            name: gateway.metadata.name,
          },
          tls: {
            clientValidation: {
              mode: "RequireAndVerify",
              caCertificateRefs: [
                {
                  group: "",
                  kind: "Secret",
                  name: caSecret.metadata.name,
                },
              ],
              subjectAltNames:
                args.dnsNames.length > 0
                  ? {
                      dnsNames: args.dnsNames.map(toDnsNameMatcher),
                    }
                  : undefined,
            },
          },
        },
      },
      { ...opts, dependsOn: caSecret, parent: gateway, provider },
    )

    return {
      resources: [caSecret, policy],
    }
  },
)
