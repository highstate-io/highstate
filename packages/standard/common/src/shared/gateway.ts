import type { TlsCertificate } from "./tls"
import { z } from "@highstate/contract"
import { type common, network } from "@highstate/library"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type Output,
  output,
  Resource,
} from "@highstate/pulumi"
import { ImplementationMediator } from "./impl-ref"

export const gatewayRouteMediator = new ImplementationMediator(
  "gateway-route",
  z.object({
    name: z.string(),
    spec: z.custom<GatewayRouteSpec>(),
    opts: z.custom<ComponentResourceOptions>().optional(),
  }),
  z.object({
    resource: z.instanceof(Resource),
    endpoints: network.l3EndpointEntity.schema.array(),
  }),
)

export type GatewayRouteSpec = {
  /**
   * The FQDN to expose the workload on.
   */
  fqdn?: Input<string>

  /**
   * The endpoints of the backend workload to route traffic to.
   */
  endpoints: Input<network.L4Endpoint[]>

  /**
   * The native data to pass to the implementation.
   *
   * This is used for data which implementation may natively understand,
   * such as Kubernetes `Service` resources.
   *
   * Implementations may use this data to create more efficient routes
   * using native resources.
   */
  nativeData?: Input<unknown>

  /**
   * The TLS certificate to use for the route.
   */
  tlsCertificate?: Input<TlsCertificate | undefined>
} & (
  | {
      type: "http"

      /**
       * Whether to expose the workload over plain HTTP.
       *
       * By default, the workload will be exposed over HTTPS.
       */
      insecure?: Input<boolean>

      /**
       * The relative path to expose the workload on.
       *
       * By default, the workload will be exposed on the root path (`/`).
       */
      path?: Input<string>
    }
  | {
      type: "tcp" | "udp"

      /**
       * The name or port of the target port on the backend endpoints to route traffic to.
       *
       * If not specified, the first port of the matching protocol will be used.
       */
      targetPort?: Input<string | number>

      /**
       * The port to expose the route on.
       *
       * If not specified, the same port as the target port will be used.
       */
      port?: Input<number>
    }
)

export type GatewayRouteArgs = GatewayRouteSpec & {
  /**
   * The gateway to attach the route to.
   */
  gateway: Input<common.Gateway>
}

export class GatewayRoute extends ComponentResource {
  /**
   * The underlying resource created by the implementation.
   */
  readonly resource: Output<Resource>

  /**
   * The endpoints of the gateway which serve this route.
   *
   * In most cases, this will be a single endpoint of the gateway shared for all routes.
   */
  readonly endpoints: Output<network.L3Endpoint[]>

  constructor(name: string, args: GatewayRouteArgs, opts?: ComponentResourceOptions) {
    super("highstate:common:GatewayRoute", name, args, opts)

    const { resource, endpoints } = gatewayRouteMediator.callOutput(output(args.gateway).implRef, {
      name,
      spec: args,
      opts: { ...opts, parent: this },
    })

    this.resource = resource
    this.endpoints = endpoints
  }
}
