import { vault } from "@highstate/library"
import {
  ComponentResource,
  type ComponentResourceOptions,
  getCombinedIdentityOutput,
  type Input,
  type InputArray,
  interpolate,
  makeEntityOutput,
  mergeOptions,
  type Output,
  output,
} from "@highstate/pulumi"
import { pkisecret } from "@pulumi/vault"
import { AppRole } from "./app-role"
import { Policy } from "./policy"
import { getProvider } from "./provider"

export type PkiIssuerArgs = {
  /**
   * The root PKI CA used to sign the intermediate issuer.
   */
  ca: Input<vault.PkiCa>

  /**
   * The PKI role name used to issue leaf certificates.
   */
  roleName: string

  /**
   * The DNS zones for which this issuer can issue certificates.
   */
  dnsNames: InputArray<string>

  /**
   * The common names for which this issuer can issue certificates.
   */
  commonNames: InputArray<string>

  /**
   * Whether the Vault role allows issuing certificates for exact allowed domains.
   */
  allowBareDomains: Input<boolean>

  /**
   * Whether the Vault role allows issuing certificates for subdomains of allowed domains.
   */
  allowSubdomains: Input<boolean>

  /**
   * Whether the Vault role allows issuing wildcard certificates.
   */
  allowWildcardCertificates: Input<boolean>
}

export class PkiIssuer extends ComponentResource {
  /**
   * The root PKI CA used to sign the intermediate issuer.
   */
  readonly ca: Output<vault.PkiCa>

  /**
   * The PKI role used to issue leaf certificates.
   */
  readonly role: Output<pkisecret.SecretBackendRole>

  /**
   * The AppRole authorized to issue certificates from this PKI issuer.
   */
  readonly appRole: AppRole

  /**
   * The DNS zones for which this issuer can issue certificates.
   */
  readonly dnsNames: Output<string[]>

  /**
   * The common names for which this issuer can issue certificates.
   */
  readonly commonNames: Output<string[]>

  /**
   * The highstate entity representing this PKI issuer.
   */
  get entity(): Output<vault.PkiIssuer> {
    return makeEntityOutput({
      entity: vault.pkiIssuerEntity,
      identity: getCombinedIdentityOutput([this.ca, this.role.name]),
      meta: {
        title: this.role.name,
      },
      value: {
        connection: this.appRole.authenticatedConnection,
        path: this.role.backend,
        roleName: this.role.name,
        dnsNames: this.dnsNames,
        commonNames: this.commonNames,
        allowBareDomains: this.role.allowBareDomains.apply(value => value ?? false),
        allowSubdomains: this.role.allowSubdomains.apply(value => value ?? false),
        allowWildcardCertificates: this.role.allowWildcardCertificates.apply(
          value => value ?? false,
        ),
      },
    })
  }

  constructor(name: string, args: PkiIssuerArgs, opts?: ComponentResourceOptions) {
    super("highstate:vault:PkiIssuer", name, args, opts)

    this.ca = output(args.ca)
    this.dnsNames = output(args.dnsNames)
    this.commonNames = output(args.commonNames)

    const caConnection = this.ca.connection
    const intermediatePath = this.ca.intermediatePath
    const policyName = interpolate`${this.ca.path}/${args.roleName}`
    const authPath = caConnection.apply(connection => {
      if (connection.credentials.type !== "approle") {
        throw new Error("Vault PKI CA connection must use AppRole credentials")
      }

      return connection.credentials.authPath
    })

    this.role = output({
      connection: caConnection,
      intermediatePath,
    }).apply(async ({ connection, intermediatePath }) => {
      const provider = await getProvider(connection)
      const allowedDomains = output([this.dnsNames, this.commonNames]).apply(values => {
        return Array.from(new Set(values.flat()))
      })

      return new pkisecret.SecretBackendRole(
        args.roleName,
        {
          backend: intermediatePath,
          name: args.roleName,
          allowedDomains,
          allowBareDomains: args.allowBareDomains,
          allowSubdomains: args.allowSubdomains,
          allowWildcardCertificates: args.allowWildcardCertificates,
          allowIpSans: false,
          allowLocalhost: false,
          requireCn: false,
          clientFlag: true,
          serverFlag: true,
          ttl: "24h",
          maxTtl: "720h",
        },
        mergeOptions(opts, { provider, parent: this }),
      )
    })

    const policy = new Policy(
      args.roleName,
      {
        connection: caConnection,
        name: policyName,
        rules: [
          {
            description: "sign certificates",
            path: interpolate`${intermediatePath}/sign/${args.roleName}`,
            capabilities: ["create", "update"],
          },
          {
            description: "issue certificates",
            path: interpolate`${intermediatePath}/issue/${args.roleName}`,
            capabilities: ["create", "update"],
          },
          {
            description: "read ca certificate",
            path: interpolate`${intermediatePath}/cert/ca`,
            capabilities: ["read"],
          },
          {
            description: "read ca pem bundle",
            path: interpolate`${intermediatePath}/ca/pem`,
            capabilities: ["read"],
          },
        ],
      },
      { parent: this },
    )

    this.appRole = new AppRole(
      args.roleName,
      {
        connection: caConnection,
        authPath,
        roleName: args.roleName,
        policies: [policy],
      },
      { parent: this },
    )
  }
}
