import type { Gateway } from "./gateway"
import { gateway, type types } from "@highstate/gateway-api"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type InputArray,
  normalizeInputs,
  normalizeInputsAndMap,
  type Output,
  output,
} from "@highstate/pulumi"
import { getProvider, mapMetadata, type ScopedResourceArgs } from "../shared"
import { type BackendRef, resolveBackendRef } from "./backend"

export type TlsRouteArgs = Omit<ScopedResourceArgs, "namespace"> & {
  /**
   * The gateway to associate with the route.
   */
  gateway: Input<Gateway>

  /**
   * The name of the listener to attach the route to.
   */
  listenerName: Input<string>

  /**
   * The hostname used to select TLS traffic by SNI.
   */
  hostname?: Input<string>

  /**
   * The hostnames used to select TLS traffic by SNI.
   */
  hostnames?: InputArray<string>

  /**
   * The backend reference handled by the route.
   */
  backend?: Input<BackendRef>

  /**
   * The backend references handled by the route.
   */
  backends?: InputArray<BackendRef>
}

export class TlsRoute extends ComponentResource {
  /**
   * The underlying Kubernetes resource.
   */
  public readonly route: Output<gateway.v1.TLSRoute>

  constructor(name: string, args: TlsRouteArgs, opts?: ComponentResourceOptions) {
    super("highstate:k8s:TlsRoute", name, args, opts)

    const gatewayOutput = output(args.gateway)
    const parentRefs = output({
      gateway: gatewayOutput,
      listenerName: args.listenerName,
    }).apply(
      ({ gateway, listenerName }) =>
        [
          {
            group: "gateway.networking.k8s.io",
            kind: "Gateway",
            name: gateway.metadata.name,
            namespace: gateway.namespace.metadata.name,
            sectionName: listenerName,
          },
        ] satisfies types.input.gateway.v1.TLSRouteSpecParentRefs[],
    )

    const backendRefs = normalizeInputsAndMap(args.backend, args.backends, resolveBackendRef)

    this.route = gatewayOutput.cluster.apply(cluster => {
      return new gateway.v1.TLSRoute(
        name,
        {
          metadata: mapMetadata(args, name).apply(metadata => ({
            ...metadata,
            namespace: gatewayOutput.namespace.metadata.name,
          })),
          spec: {
            hostnames: normalizeInputs(args.hostname, args.hostnames),
            parentRefs,
            rules: [{ backendRefs }],
          } satisfies types.input.gateway.v1.TLSRouteSpec,
        },
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })
  }
}
