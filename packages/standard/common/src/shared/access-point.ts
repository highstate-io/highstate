import type { common } from "@highstate/library"
import type { Except } from "type-fest"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type Output,
  output,
  toPromise,
} from "@highstate/pulumi"
import { DnsRecordSet } from "./dns"
import { GatewayRoute, type GatewayRouteSpec } from "./gateway"
import { TlsCertificate } from "./tls"

export type AccessPointRouteArgs = Except<GatewayRouteSpec, "nativeData"> & {
  /**
   * The access point to use to expose the route.
   */
  accessPoint: Input<common.AccessPoint>

  /**
   * The native data to pass to the gateway route implementation.
   */
  gatewayNativeData?: unknown

  /**
   * The native data to pass to the tls ceertificate implementation.
   */
  tlsCertificateNativeData?: unknown
}

export class AccessPointRoute extends ComponentResource {
  /**
   * The created gateway route.
   */
  readonly route: GatewayRoute

  /**
   * The DNS record set created for the route.
   *
   * May be shared between multiple routes with the same FQDN.
   */
  readonly dnsRecordSet?: Output<DnsRecordSet | undefined>

  /**
   * The TLS certificate created for the route.
   *
   * May be shared between multiple routes with the same FQDN.
   */
  readonly tlsCertificate?: Output<TlsCertificate | undefined>

  constructor(name: string, args: AccessPointRouteArgs, opts?: ComponentResourceOptions) {
    super("highstate:common:AccessPointRoute", name, args, opts)

    // 1. create TLS certificate if the route is HTTPS and the access point has TLS issuers
    if (args.fqdn && args.type === "http" && !args.insecure) {
      this.tlsCertificate = output(args.accessPoint).apply(accessPoint => {
        if (accessPoint.tlsIssuers.length === 0) {
          return undefined
        }

        return TlsCertificate.createOnce(
          name,
          {
            issuers: accessPoint.tlsIssuers,
            dnsNames: args.fqdn ? [args.fqdn] : [],
            nativeData: args.tlsCertificateNativeData,
          },
          { ...opts, parent: this },
        )
      })
    }

    // 2. create the route and resolve the gateway endpoints
    this.route = new GatewayRoute(
      name,
      {
        ...args,
        gateway: output(args.accessPoint).gateway,
        tlsCertificate: this.tlsCertificate,
        nativeData: args.gatewayNativeData,
      },
      { ...opts, parent: this },
    )

    // 3. register DNS records if FQDN is provided and the access point has DNS providers
    if (args.fqdn) {
      this.dnsRecordSet = output(args.accessPoint).apply(async accessPoint => {
        if (accessPoint.dnsProviders.length === 0) {
          return undefined
        }

        const fqdn = await toPromise(args.fqdn)
        if (!fqdn) {
          return undefined
        }

        return DnsRecordSet.createOnce(
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
    }
  }
}
