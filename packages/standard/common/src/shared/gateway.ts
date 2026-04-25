import type { TlsCertificate } from "./tls"
import { z } from "@highstate/contract"
import { type common, type MetadataKey, network } from "@highstate/library"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type InputRecord,
  normalize,
  type Output,
  output,
  Resource,
  type Unwrap,
} from "@highstate/pulumi"
import { ImplementationMediator } from "./impl-ref"

export const gatewayRouteMediator = new ImplementationMediator(
  "gateway-route",
  z.object({
    name: z.string(),
    args: z.custom<NormalizedGatewayRouteArgs>(),
    opts: z.custom<ComponentResourceOptions>().optional(),
  }),
  z.object({
    resource: z.instanceof(Resource),

    /**
     * The endpoints of the gateway that will serve the route.
     */
    endpoints: network.l3EndpointEntity.schema.array(),
  }),
)

export type GatewayBackendArgs = {
  /**
   * The endpoints of the backend workload to route traffic to.
   *
   * Note: all endpoints are treated as a single backend.
   * Gateway implementation should choose the best one and use route traffic to it.
   */
  endpoints: Input<network.L4Endpoint[]>

  /**
   * The weight of the backend for traffic splitting.
   *
   * May not be supported by all implementations.
   */
  weight?: Input<number>
}

export type GatewayRuleArgs = {
  /**
   * The backend to route traffic to if the rule matches.
   */
  backend?: Input<GatewayBackendArgs>

  /**
   * The backends to route traffic to if the rule matches.
   */
  backends?: Input<GatewayBackendArgs[]>
}

export type GatewayHttpRuleArgs = GatewayRuleArgs & {
  /**
   * The path to match for the rule.
   */
  path?: Input<string>

  /**
   * The paths to match for the rule.
   */
  paths?: Input<string[]>
}

export type GatewayRouteArgs = {
  /**
   * The gateway to attach the route to.
   */
  gateway: Input<common.Gateway>

  /**
   * The extra metadata to pass to the gateway route implementation.
   */
  metadata?: Input<Record<MetadataKey, Input<unknown>>>

  /**
   * The fqdn to match for the listener.
   */
  fqdn?: Input<string>

  /**
   * The fqdns to match for the listener.
   */
  fqdns?: Input<string[]>

  /**
   * The certificate to use for TLS termination for the listener.
   *
   * If not specified, listener will accept plain TCP/HTTP traffic.
   */
  certificate?: Input<TlsCertificate>

  /**
   * The port to listen on.
   *
   * If not specified, the default port for the protocol will be used (80 for HTTP, 443 for HTTPS, etc.).
   */
  port?: Input<number>
} & (
  | {
      type: "tcp" | "udp"
      rules?: InputRecord<GatewayRuleArgs>
    }
  | {
      type: "http"

      /**
       * The path to match for the `default` rule of the listener.
       *
       * Its shortcut for `rules.default.paths`.
       */
      path?: Input<string>

      /**
       * The paths to match for the `default` rule of the listener.
       *
       * Its shortcut for `rules.default.paths`.
       */
      paths?: Input<string[]>

      /**
       * The rules to apply for the listener.
       */
      rules?: InputRecord<GatewayHttpRuleArgs>
    }
) & {
    /**
     * The backend to route traffic to if the paths of the `default` rule match.
     *
     * Its shortcut for `rules.default.backend`.
     */
    backend?: Input<GatewayBackendArgs>

    /**
     * The backends to route traffic to if the paths of the `default` rule match.
     *
     * Its shortcut for `rules.default.backends`.
     */
    backends?: Input<GatewayBackendArgs[]>
  }

type NormalizedGatewayBackend = {
  endpoints: network.L4Endpoint[]
  weight?: number
}

type NormalizedGatewayRuleArgs = {
  type: "http" | "tcp" | "udp"
  paths: string[]
  backends: NormalizedGatewayBackend[]
}

type NormalizedGatewayRouteArgs = {
  gateway: common.Gateway
  metadata: Record<MetadataKey, unknown>
  fqdns: string[]
  type: "http" | "tcp" | "udp"
  certificate?: TlsCertificate
  port?: number
  rules: Record<string, NormalizedGatewayRuleArgs>
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

    const normalizedInput = output(args).apply(args => ({
      name,
      args: GatewayRoute.normalizeArgs(args),
      opts: { ...opts, parent: this },
    }))

    const { resource, endpoints } = gatewayRouteMediator.callOutput(
      output(args.gateway).implRef,
      normalizedInput,
    )

    this.resource = resource
    this.endpoints = endpoints
  }

  private static normalizeArgs(args: Unwrap<GatewayRouteArgs>): NormalizedGatewayRouteArgs {
    const defaultRule = GatewayRoute.normalizeRuleArgs(
      args.type,
      args.type === "http"
        ? [
            {
              path: args.path,
              paths: args.paths,
              backend: args.backend,
              backends: args.backends,
            },
          ]
        : [
            {
              backend: args.backend,
              backends: args.backends,
            },
          ],
    )

    const namedRules = Object.entries(args.rules ?? {}).reduce<
      Record<string, NormalizedGatewayRuleArgs>
    >((acc, [ruleName, ruleArgs]) => {
      const rule = GatewayRoute.normalizeRuleArgs(args.type, ruleArgs)
      if (rule) {
        acc[ruleName] = rule
      }

      return acc
    }, {})

    return {
      gateway: args.gateway,
      metadata: args.metadata ?? {},
      fqdns: normalize(args.fqdn, args.fqdns),
      type: args.type,
      certificate: args.certificate,
      port: args.port,
      rules: GatewayRoute.mergeRules(defaultRule ? { default: defaultRule } : {}, namedRules),
    }
  }

  private static normalizeRuleArgs(
    type: "http" | "tcp" | "udp",
    ruleArgs:
      | Unwrap<GatewayRuleArgs>
      | Unwrap<GatewayRuleArgs>[]
      | Unwrap<GatewayHttpRuleArgs>
      | Unwrap<GatewayHttpRuleArgs>[],
  ): NormalizedGatewayRuleArgs | undefined {
    const normalizedRuleArgs = Array.isArray(ruleArgs) ? ruleArgs : [ruleArgs]

    const paths =
      type === "http"
        ? normalizedRuleArgs.flatMap(rule =>
            normalize(
              (rule as Unwrap<GatewayHttpRuleArgs>).path,
              (rule as Unwrap<GatewayHttpRuleArgs>).paths,
            ),
          )
        : []

    const backends = normalizedRuleArgs.flatMap(rule => normalize(rule.backend, rule.backends))

    if (paths.length === 0 && backends.length === 0) {
      return undefined
    }

    return {
      type,
      paths: type === "http" ? (paths.length > 0 ? paths : ["/"]) : [],
      backends,
    }
  }

  private static mergeRules(
    first: Record<string, NormalizedGatewayRuleArgs>,
    second: Record<string, NormalizedGatewayRuleArgs>,
  ): Record<string, NormalizedGatewayRuleArgs> {
    const result = { ...first }

    for (const [ruleName, rule] of Object.entries(second)) {
      const existing = result[ruleName]

      result[ruleName] = existing ? GatewayRoute.mergeRule(existing, rule) : rule
    }

    return result
  }

  private static mergeRule(
    first: NormalizedGatewayRuleArgs,
    second: NormalizedGatewayRuleArgs,
  ): NormalizedGatewayRuleArgs {
    if (first.type !== second.type) {
      throw new Error("Gateway rules with the same name must use the same protocol type")
    }

    return {
      type: first.type,
      paths: [...first.paths, ...second.paths],
      backends: [...first.backends, ...second.backends],
    }
  }
}
