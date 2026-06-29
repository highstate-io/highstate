import { type tls, vault } from "@highstate/library"
import {
  ComponentResource,
  type ComponentResourceOptions,
  getCombinedIdentityOutput,
  type Input,
  interpolate,
  makeEntityOutput,
  mergeOptions,
  type Output,
  output,
} from "@highstate/pulumi"
import { pkisecret } from "@pulumi/vault"
import { AppRole } from "./app-role"
import { AppRoleAuthBackend } from "./auth-backend"
import { PkiMount } from "./mount"
import { Policy } from "./policy"
import { getProvider } from "./provider"

export type PkiCaArgs = {
  /**
   * The connection to the Vault instance.
   */
  connection: Input<vault.Connection>

  /**
   * The mount path of the root PKI backend.
   */
  path: Input<string>

  /**
   * The common name of the root CA certificate.
   */
  commonName: Input<string>

  /**
   * The TTL of the generated root CA certificate.
   */
  ttl: Input<string>

  /**
   * The private key configuration for the root CA certificate.
   */
  privateKey: Input<tls.PrivateKeySpec>

  /**
   * The default lease TTL of the root PKI backend in seconds.
   */
  defaultLeaseTtlSeconds: Input<number>

  /**
   * The maximum lease TTL of the root PKI backend in seconds.
   */
  maxLeaseTtlSeconds: Input<number>

  /**
   * The intermediate PKI backend and CA certificate configuration.
   */
  intermediate: {
    /**
     * The mount path of the intermediate PKI backend used by issuers.
     */
    path: Input<string>

    /**
     * The common name of the intermediate CA certificate.
     */
    commonName: Input<string>

    /**
     * The TTL of the generated intermediate CA certificate.
     */
    ttl: Input<string>

    /**
     * The private key configuration for the intermediate CA certificate.
     */
    privateKey: Input<tls.PrivateKeySpec>

    /**
     * The default lease TTL of the intermediate PKI backend in seconds.
     */
    defaultLeaseTtlSeconds: Input<number>

    /**
     * The maximum lease TTL of the intermediate PKI backend in seconds.
     */
    maxLeaseTtlSeconds: Input<number>
  }
}

function toVaultKeyType(algorithm: tls.PrivateKeyAlgorithm): string {
  if (algorithm === "ECDSA") {
    return "ec"
  }

  return algorithm.toLowerCase()
}

export class PkiCa extends ComponentResource {
  /**
   * The connection associated with the root PKI CA.
   */
  readonly connection: Output<vault.Connection>

  /**
   * The root PKI mount.
   */
  readonly mount: PkiMount

  /**
   * The intermediate PKI mount used by issuers.
   */
  readonly intermediateMount: PkiMount

  /**
   * The root CA certificate resource.
   */
  readonly rootCert: Output<pkisecret.SecretBackendRootCert>

  /**
   * The intermediate CA certificate request resource.
   */
  readonly intermediateRequest: Output<pkisecret.SecretBackendIntermediateCertRequest>

  /**
   * The signed intermediate CA certificate resource.
   */
  readonly signedIntermediate: Output<pkisecret.SecretBackendRootSignIntermediate>

  /**
   * The resource that installs the signed intermediate certificate.
   */
  readonly installedIntermediate: Output<pkisecret.SecretBackendIntermediateSetSigned>

  /**
   * The AppRole authorized to manage this PKI CA.
   */
  readonly appRole: AppRole

  /**
   * The highstate entity representing this root PKI CA.
   */
  get entity(): Output<vault.PkiCa> {
    return makeEntityOutput({
      entity: vault.pkiCaEntity,
      identity: getCombinedIdentityOutput([this.connection, this.mount.mount.path]),
      meta: {
        title: this.mount.mount.path,
      },
      value: {
        connection: this.appRole.authenticatedConnection,
        path: this.mount.mount.path,
        intermediatePath: this.intermediateMount.mount.path,
        commonName: this.rootCert.commonName,
      },
    })
  }

  constructor(name: string, args: PkiCaArgs, opts?: ComponentResourceOptions) {
    super("highstate:vault:PkiCa", name, args, opts)

    this.connection = output(args.connection)

    this.mount = new PkiMount(
      name,
      {
        connection: args.connection,
        path: args.path,
        defaultLeaseTtlSeconds: args.defaultLeaseTtlSeconds,
        maxLeaseTtlSeconds: args.maxLeaseTtlSeconds,
      },
      { parent: this },
    )

    this.rootCert = output({ connection: this.connection, mount: this.mount.mount }).apply(
      async ({ connection, mount }) => {
        const provider = await getProvider(connection)

        return new pkisecret.SecretBackendRootCert(
          name,
          {
            backend: mount.path,
            type: "internal",
            commonName: args.commonName,
            ttl: args.ttl,
            format: "pem",
            privateKeyFormat: "der",
            keyType: output(args.privateKey).algorithm.apply(toVaultKeyType),
            keyBits: output(args.privateKey).size,
            excludeCnFromSans: true,
          },
          mergeOptions(opts, { provider, parent: this }),
        )
      },
    )

    this.intermediateMount = new PkiMount(
      `${name}-intermediate`,
      {
        connection: args.connection,
        path: args.intermediate.path,
        defaultLeaseTtlSeconds: args.intermediate.defaultLeaseTtlSeconds,
        maxLeaseTtlSeconds: args.intermediate.maxLeaseTtlSeconds,
      },
      { parent: this },
    )

    this.intermediateRequest = output({
      connection: this.connection,
      mount: this.intermediateMount.mount,
    }).apply(async ({ connection, mount }) => {
      const provider = await getProvider(connection)

      return new pkisecret.SecretBackendIntermediateCertRequest(
        name,
        {
          backend: mount.path,
          type: "internal",
          commonName: args.intermediate.commonName,
          keyType: output(args.intermediate.privateKey).algorithm.apply(toVaultKeyType),
          keyBits: output(args.intermediate.privateKey).size,
        },
        mergeOptions(opts, { provider, parent: this }),
      )
    })

    this.signedIntermediate = output({
      connection: this.connection,
      request: this.intermediateRequest,
      rootCert: this.rootCert,
      rootMount: this.mount.mount,
    }).apply(async ({ connection, request, rootCert, rootMount }) => {
      const provider = await getProvider(connection)

      return new pkisecret.SecretBackendRootSignIntermediate(
        name,
        {
          backend: rootMount.path,
          csr: request.csr,
          commonName: args.intermediate.commonName,
          ttl: args.intermediate.ttl,
          format: "pem_bundle",
          excludeCnFromSans: true,
        },
        mergeOptions(opts, { dependsOn: rootCert, provider, parent: this }),
      )
    })

    this.installedIntermediate = output({
      connection: this.connection,
      mount: this.intermediateMount.mount,
      signedIntermediate: this.signedIntermediate,
    }).apply(async ({ connection, mount, signedIntermediate }) => {
      const provider = await getProvider(connection)

      return new pkisecret.SecretBackendIntermediateSetSigned(
        name,
        {
          backend: mount.path,
          certificate: signedIntermediate.certificateBundle,
        },
        mergeOptions(opts, { provider, parent: this }),
      )
    })

    const authBackend = new AppRoleAuthBackend(
      name,
      {
        connection: args.connection,
        path: args.path,
      },
      { parent: this },
    )

    const policy = new Policy(
      name,
      {
        connection: args.connection,
        name: args.path,
        rules: [
          {
            description: "manage root pki backend",
            path: interpolate`${args.path}/*`,
            capabilities: ["create", "read", "update", "delete", "list", "sudo"],
          },
          {
            description: "manage intermediate pki backend",
            path: interpolate`${args.intermediate.path}/*`,
            capabilities: ["create", "read", "update", "delete", "list", "sudo"],
          },
          {
            description: "manage pki mounts",
            path: "sys/mounts/pki/*",
            capabilities: ["create", "read", "update", "delete", "list", "sudo"],
          },
          {
            description: "manage ca policy",
            path: interpolate`sys/policies/acl/${args.path}`,
            capabilities: ["create", "read", "update", "delete", "list", "sudo"],
          },
          {
            description: "manage ca issuer policies",
            path: interpolate`sys/policies/acl/${args.path}/*`,
            capabilities: ["create", "read", "update", "delete", "list", "sudo"],
          },
          {
            description: "create provider child tokens",
            path: "auth/token/create",
            capabilities: ["update"],
          },
          {
            description: "manage ca approles",
            path: interpolate`auth/${args.path}/role/*`,
            capabilities: ["create", "read", "update", "delete", "list", "sudo"],
          },
        ],
      },
      { parent: this },
    )

    this.appRole = new AppRole(
      name,
      {
        authBackend,
        policies: [policy],
      },
      { parent: this },
    )
  }
}
