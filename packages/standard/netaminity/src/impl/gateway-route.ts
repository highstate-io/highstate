import { gatewayRouteMediator } from "@highstate/common"
import { netaminity } from "@highstate/library"

export const createGatewayRoute = gatewayRouteMediator.implement(
  netaminity.gatewayDataSchema,
  async ({ name, args, opts }, data) => {
    if (args.type !== "http") {
      throw new Error("Netaminity Gateway supports only HTTP routes with TLS termination")
    }
    if (!args.certificate) {
      throw new Error("Netaminity Gateway routes require a TLS certificate")
    }
    if (args.fqdns.length === 0) {
      throw new Error("Netaminity Gateway routes require at least one FQDN")
    }
    if (args.port !== undefined && args.port !== data.targetGatewayPort) {
      throw new Error("Netaminity Gateway route port must match targetGatewayPort")
    }

    await gatewayRouteMediator.call(data.targetImplRef, {
      name: `${name}-target`,
      args: { ...args, gateway: data.targetGateway },
      opts,
    })

    const proxyMetadata = { ...args.metadata }
    delete proxyMetadata["k8s.namespace"]

    return await gatewayRouteMediator.call(data.proxyImplRef, {
      name: `${name}-proxy`,
      args: {
        gateway: data.proxyGateway,
        metadata: proxyMetadata,
        fqdns: args.fqdns,
        type: "tls",
        port: data.targetGatewayPort,
        rules: {
          default: {
            type: "tls",
            paths: [],
            backends: [{ endpoints: data.tunnelEndpoints }],
          },
        },
      },
      opts,
    })
  },
)
