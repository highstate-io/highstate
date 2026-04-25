import type { common, MetadataKey } from "@highstate/library"
import type { Except } from "type-fest"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  normalizeInputs,
  type Output,
  output,
} from "@highstate/pulumi"
import { DnsRecordSet } from "./dns"
import { GatewayRoute, type GatewayRouteArgs } from "./gateway"
import { TlsCertificate } from "./tls"

export type AccessPointRouteArgs = Except<GatewayRouteArgs, "gateway" | "metadata"> & {
  /**
   * The access point to use to expose the route.
   */
  accessPoint: Input<common.AccessPoint>

  /**
   * Whether the route should be created without TLS even if the access point has TLS issuers.
   */
  plain?: Input<boolean>

  /**
   * The extra metadata to pass to the gateway route and tls certificate implementations.
   */
  metadata?: Input<Record<MetadataKey, Input<unknown>>>
}

export class AccessPointRoute extends ComponentResource {
  /**
   * The created gateway route.
   */
  readonly route: Output<GatewayRoute>

  /**
   * The DNS record sets created for the each FQDN of the route.
   */
  readonly dnsRecordSets: Output<DnsRecordSet[]>

  /**
   * The TLS certificate created for the route.
   *
   * May be shared between multiple routes with the same FQDN.
   */
  readonly tlsCertificate: Output<TlsCertificate | undefined>

  constructor(name: string, args: AccessPointRouteArgs, opts?: ComponentResourceOptions) {
    super("highstate:common:AccessPointRoute", name, args, opts)

    // 1. create TLS certificate if the route is HTTPS and the access point has TLS issuers
    if (args.fqdn && args.type === "http" && !args.plain) {
      this.tlsCertificate = output(args.accessPoint).apply(accessPoint => {
        if (accessPoint.tlsIssuers.length === 0) {
          return undefined
        }

        return TlsCertificate.createOnce(
          name,
          {
            issuers: accessPoint.tlsIssuers,
            dnsNames: normalizeInputs(args.fqdn, args.fqdns),
            metadata: args.metadata,
          },
          { ...opts, parent: this },
        )
      })
    } else {
      this.tlsCertificate = output(undefined)
    }

    // 2. create the route and resolve the gateway endpoints
    this.route = this.tlsCertificate.apply(tlsCertificate => {
      return new GatewayRoute(
        name,
        {
          ...args,
          gateway: output(args.accessPoint).gateway,
          certificate: tlsCertificate,
          metadata: args.metadata,
        },
        { ...opts, parent: this },
      )
    })

    // 3. register DNS records if FQDN is provided and the access point has DNS providers
    this.dnsRecordSets = output({
      accessPoint: args.accessPoint,
      fqdns: normalizeInputs(args.fqdn, args.fqdns),
    }).apply(async ({ accessPoint, fqdns }) => {
      if (accessPoint.dnsProviders.length === 0) {
        return []
      }

      return fqdns.map(fqdn => {
        return new DnsRecordSet(
          fqdn,
          {
            providers: output(args.accessPoint).dnsProviders,
            values:
              accessPoint.gateway.endpoints.length > 0
                ? accessPoint.gateway.endpoints
                : this.route.endpoints,
            waitAt: "local",
            proxied: accessPoint.proxied,
          },
          { ...opts, parent: this },
        )
      })
    })
  }
}
