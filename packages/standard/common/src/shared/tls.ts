import type { common } from "@highstate/library"
import { getOrCreate, z } from "@highstate/contract"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type InputArray,
  normalizeInputs,
  type Output,
  output,
  Resource,
} from "@highstate/pulumi"
import { ImplementationMediator } from "./impl-ref"

export const tlsCertificateMediator = new ImplementationMediator(
  "tls-certificate",
  z.object({
    name: z.string(),
    spec: z.custom<TlsCertificateSpec>(),
    opts: z.custom<ComponentResourceOptions>().optional(),
  }),
  z.instanceof(Resource),
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
   * The native data to pass to the implementation.
   *
   * This is used for data which implementation may natively understand
   * and may use this data to create certificates using native resources.
   */
  nativeData?: unknown
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

  constructor(name: string, args: TlsCertificateArgs, opts?: ComponentResourceOptions) {
    super("highstate:common:TlsCertificate", name, args, opts)

    const issuers = normalizeInputs(args.issuer, args.issuers)

    this.resource = output({
      issuers,
      commonName: args.commonName,
      dnsNames: args.dnsNames,
    }).apply(async ({ issuers, commonName, dnsNames }) => {
      // for now, we require single issuer to match all requested names
      const matchedIssuer = issuers.find(issuer => {
        if (commonName && !commonName.endsWith(issuer.domain)) {
          return false
        }

        if (dnsNames && !dnsNames.every(name => name.endsWith(issuer.domain))) {
          return false
        }

        return true
      })

      if (!matchedIssuer) {
        throw new Error(
          `No TLS issuer matched the common name "${commonName}" and DNS names "${dnsNames?.join(", ") ?? ""}"`,
        )
      }

      return await tlsCertificateMediator.call(matchedIssuer.implRef, {
        name,
        spec: args,
      })
    })
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
