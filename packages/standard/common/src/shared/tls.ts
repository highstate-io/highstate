import type { common, MetadataKey, tls } from "@highstate/library"
import { getOrCreate, z } from "@highstate/contract"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type InputArray,
  normalizeInputs,
  type Output,
  output,
  type Resource,
} from "@highstate/pulumi"
import { ImplementationMediator } from "./impl-ref"

export type TlsCertificateResult = {
  /**
   * The underlying resource created by the implementation.
   */
  resource: Resource

  /**
   * The common TLS certificate entity.
   */
  certificate: Output<tls.Certificate>
}

export const tlsCertificateMediator = new ImplementationMediator(
  "tls-certificate",
  z.object({
    name: z.string(),
    spec: z.custom<TlsCertificateSpec>(),
    opts: z.custom<ComponentResourceOptions>().optional(),
  }),
  z.custom<TlsCertificateResult>(),
)

export type TlsCertificateSpec = {
  /**
   * The common name for the certificate.
   */
  commonName?: Input<string>

  /**
   * The alternative DNS names for the certificate.
   */
  dnsNames?: InputArray<string>

  /**
   * The private key configuration for the certificate.
   */
  privateKey?: Input<tls.PrivateKeySpec>

  /**
   * The requested key usages for the certificate.
   */
  usages?: InputArray<tls.CertificateUsage>

  /**
   * The extra metadata to pass to the TLS certificate implementation.
   */
  metadata?: Input<Record<MetadataKey, Input<unknown>>>
}

export type TlsCertificateArgs = TlsCertificateSpec & {
  /**
   * The issuer to use for the certificate.
   */
  issuer?: Input<common.TlsIssuer>

  /**
   * The issuers to use for the certificate.
   *
   * If multiple issuers are provided, the certificate will be created using the first issuer that supports the requested common name.
   */
  issuers?: InputArray<common.TlsIssuer>
}

export class TlsCertificate extends ComponentResource {
  /**
   * The underlying resource created by the implementation.
   */
  readonly resource: Output<Resource>

  /**
   * The issued certificate entity.
   */
  readonly certificate: Output<tls.Certificate>

  constructor(name: string, args: TlsCertificateArgs, opts?: ComponentResourceOptions) {
    super("highstate:common:TlsCertificate", name, args, opts)

    const issuers = normalizeInputs(args.issuer, args.issuers)

    const result = output({
      issuers,
      commonName: args.commonName,
      dnsNames: args.dnsNames,
      privateKey: args.privateKey,
      usages: args.usages,
    }).apply(async ({ issuers, commonName, dnsNames, privateKey }) => {
      // for now, we require single issuer to match all requested names
      const matchedIssuer = issuers.find(issuer => {
        if (commonName && !issuer.zones.some(zone => commonName.endsWith(zone))) {
          return false
        }

        if (dnsNames && !dnsNames.every(name => issuer.zones.some(zone => name.endsWith(zone)))) {
          return false
        }

        return true
      })

      if (!matchedIssuer) {
        if (commonName && dnsNames && dnsNames.length > 0) {
          const dnsNameList = dnsNames.join(", ")

          throw new Error(
            `No TLS issuer matched the common name "${commonName}" and DNS names "${dnsNameList}"`,
          )
        }

        if (commonName) {
          throw new Error(`No TLS issuer matched the common name "${commonName}"`)
        }

        if (dnsNames && dnsNames.length > 0) {
          const dnsNameList = dnsNames.join(", ")

          throw new Error(`No TLS issuer matched the DNS names "${dnsNameList}"`)
        }

        throw new Error("No TLS issuer provided")
      }

      return await tlsCertificateMediator.call(matchedIssuer.implRef, {
        name,
        spec: {
          commonName,
          dnsNames,
          privateKey,
          usages: args.usages,
          metadata: args.metadata,
        },
      })
    })

    this.resource = result.resource
    this.certificate = result.certificate
  }

  private static readonly tlsCertificateCache = new Map<string, TlsCertificate>()

  /**
   * Creates a TLS certificate for the specified common name and DNS names.
   *
   * If a TLS certificate with the same name already exists, it will be reused.
   *
   * @param name The name of the TLS certificate.
   * @param args The arguments for the TLS certificate.
   * @param opts The options for the resource.
   */
  static createOnce(
    name: string,
    args: TlsCertificateArgs,
    opts?: ComponentResourceOptions,
  ): TlsCertificate {
    return getOrCreate(
      TlsCertificate.tlsCertificateCache,
      name,
      () => new TlsCertificate(name, args, opts),
    )
  }
}
