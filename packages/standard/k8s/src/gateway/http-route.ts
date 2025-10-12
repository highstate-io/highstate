import type { Gateway } from "./gateway"
import { gateway, type types } from "@highstate/gateway-api"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type InputArray,
  normalize,
  normalizeInputs,
  normalizeInputsAndMap,
  type Output,
  output,
} from "@highstate/pulumi"
import { map, pipe } from "remeda"
import { getProvider, mapMetadata, type ScopedResourceArgs } from "../shared"
import { type BackendRef, resolveBackendRef } from "./backend"

export type HttpRouteArgs = Omit<ScopedResourceArgs, "namespace"> & {
  /**
   * The gateway to associate with the route.
   */
  gateway: Input<Gateway>

  /**
   * The alias for `hostnames: [hostname]`.
   */
  hostname?: Input<string>

  /**
   * The rule of the route.
   */
  rule?: Input<HttpRouteRuleArgs>

  /**
   * The rules of the route.
   */
  rules?: InputArray<HttpRouteRuleArgs>
} & Omit<Partial<types.input.gateway.v1.HTTPRouteSpec>, "rules">

export type HttpRouteRuleArgs = Omit<
  types.input.gateway.v1.HTTPRouteSpecRules,
  "matches" | "filters" | "backendRefs"
> & {
  /**
   * The conditions of the rule.
   * Can be specified as string to match on the path.
   */
  matches?: InputArray<HttpRouteRuleMatchOptions>

  /**
   * The condition of the rule.
   * Can be specified as string to match on the path.
   */
  match?: Input<HttpRouteRuleMatchOptions>

  /**
   * The filters of the rule.
   */
  filters?: InputArray<types.input.gateway.v1.HTTPRouteSpecRulesFilters>

  /**
   * The filter of the rule.
   */
  filter?: Input<types.input.gateway.v1.HTTPRouteSpecRulesFilters>

  /**
   * The service to route to.
   */
  backend?: Input<BackendRef>

  /**
   * The services to route to.
   */
  backends?: InputArray<BackendRef>
}

export type HttpRouteRuleMatchOptions = types.input.gateway.v1.HTTPRouteSpecRulesMatches | string

export class HttpRoute extends ComponentResource {
  /**
   * The underlying Kubernetes resource.
   */
  public readonly route: Output<gateway.v1.HTTPRoute>

  constructor(name: string, args: HttpRouteArgs, opts?: ComponentResourceOptions) {
    super("highstate:k8s:HttpRoute", name, args, opts)

    this.route = output(args.gateway).cluster.apply(cluster => {
      return new gateway.v1.HTTPRoute(
        name,
        {
          metadata: mapMetadata(args, name).apply(metadata => ({
            ...metadata,
            namespace: output(args.gateway).namespace.metadata.name,
          })),
          spec: {
            hostnames: normalizeInputs(args.hostname, args.hostnames),

            parentRefs: [
              {
                name: output(args.gateway).metadata.name,
              },
            ],

            rules: normalizeInputsAndMap(args.rule, args.rules, rule => ({
              timeouts: rule.timeouts,

              matches: pipe(
                normalize(rule.match, rule.matches),
                map(mapHttpRouteRuleMatch),
                addDefaultPathMatch,
              ),

              filters: normalize(rule.filter, rule.filters),
              backendRefs: normalizeInputsAndMap(rule.backend, rule.backends, resolveBackendRef),
            })),
          } satisfies types.input.gateway.v1.HTTPRouteSpec,
        },
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })
  }
}

function addDefaultPathMatch(
  matches: types.input.gateway.v1.HTTPRouteSpecRulesMatches[],
): types.input.gateway.v1.HTTPRouteSpecRulesMatches[] {
  return matches.length ? matches : [{ path: { type: "PathPrefix", value: "/" } }]
}

export function mapHttpRouteRuleMatch(
  match: HttpRouteRuleMatchOptions,
): types.input.gateway.v1.HTTPRouteSpecRulesMatches {
  if (typeof match === "string") {
    return { path: { type: "PathPrefix", value: match } }
  }

  return match
}
