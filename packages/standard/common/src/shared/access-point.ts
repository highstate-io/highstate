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
import { isDnsNameInZone, normalizeDnsName } from "./dns-challenge"
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
   * The existing CNAME target that will hold the DNS01 verification TXT record for fqdn.
   */
  dnsChallengeAlias?: Input<string>

  /**
   * The delegated TXT record locations for routes with multiple certificate names.
   */
  dnsChallengeAliases?: Input<Record<string, string>>

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
    this.tlsCertificate = output({
      accessPoint: args.accessPoint,
      fqdn: args.fqdn,
      fqdns: normalizeInputs(args.fqdn, args.fqdns),
      plain: args.plain,
      alias: args.dnsChallengeAlias,
      aliases: args.dnsChallengeAliases,
    }).apply(({ accessPoint, fqdn, fqdns, plain, alias, aliases }) => {
      if (alias && !fqdn) {
        throw new Error("A DNS challenge alias requires an application FQDN")
      }

      const dnsChallengeAliases = { ...aliases, ...(fqdn && alias ? { [fqdn]: alias } : {}) }
      const hasAliases = Object.keys(dnsChallengeAliases).length > 0

      if (
        fqdns.length === 0 ||
        args.type !== "http" ||
        plain ||
        accessPoint.tlsIssuers.length === 0
      ) {
        if (hasAliases) {
          throw new Error("DNS challenge aliases require an HTTPS route with a TLS issuer")
        }

        return undefined
      }

      return TlsCertificate.createOnce(
        name,
        {
          issuers: accessPoint.tlsIssuers,
          dnsNames: fqdns,
          dnsChallengeAliases,
          metadata: args.metadata,
        },
        { ...opts, parent: this },
      )
    })

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
      alias: args.dnsChallengeAlias,
      aliases: args.dnsChallengeAliases,
      fqdn: args.fqdn,
    }).apply(async ({ accessPoint, fqdns, alias, aliases, fqdn: primaryFqdn }) => {
      if (accessPoint.dnsProviders.length === 0) {
        return []
      }

      const delegatedNames = new Set([
        ...Object.keys(aliases ?? {}).map(normalizeDnsName),
        ...(primaryFqdn && alias ? [normalizeDnsName(primaryFqdn)] : []),
      ])

      return fqdns
        .filter(fqdn => {
          return (
            !delegatedNames.has(normalizeDnsName(fqdn)) ||
            accessPoint.dnsProviders.some(provider =>
              provider.zones.some(zone => isDnsNameInZone(fqdn, zone)),
            )
          )
        })
        .map(fqdn => {
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
