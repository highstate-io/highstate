import type { AppRoleAuthBackend } from "./auth-backend"
import type { Policy } from "./policy"
import { getEntityId } from "@highstate/contract"
import { vault } from "@highstate/library"
import {
  ComponentResource,
  type ComponentResourceOptions,
  getCombinedIdentityOutput,
  type Input,
  type InputArray,
  makeEntityOutput,
  makeSecretOutput,
  mergeOptions,
  type Output,
  output,
  toPromise,
} from "@highstate/pulumi"
import { approle } from "@pulumi/vault"
import { getProvider } from "./provider"

export type AppRoleArgs = {
  /**
   * The AppRole auth backend to create the role in.
   */
  authBackend?: Input<AppRoleAuthBackend>

  /**
   * The connection to the Vault instance.
   *
   * Required when `authBackend` is not provided.
   */
  connection?: Input<vault.Connection>

  /**
   * The AppRole auth backend path.
   *
   * Required when `authBackend` is not provided.
   */
  authPath?: Input<string>

  /**
   * The name of the role.
   */
  roleName?: Input<string>

  /**
   * The policies to attach to tokens created by this AppRole.
   */
  policies: InputArray<Policy>
}

export class AppRole extends ComponentResource {
  /**
   * The connection associated with the AppRole.
   */
  readonly connection: Output<vault.Connection>

  /**
   * The auth backend path associated with the AppRole.
   */
  readonly authPath: Output<string>

  /**
   * The underlying Vault AppRole resource.
   */
  readonly role: Output<approle.AuthBackendRole>

  /**
   * The underlying Vault AppRole secret ID resource.
   */
  readonly secretId: Output<approle.AuthBackendRoleSecretId>

  /**
   * The highstate Vault connection authenticated through this AppRole.
   */
  get authenticatedConnection(): Output<vault.Connection> {
    return makeEntityOutput({
      entity: vault.connectionEntity,
      identity: getCombinedIdentityOutput([this.connection, this.role.roleName]),
      meta: {
        title: this.role.roleName,
      },
      value: {
        endpoints: this.connection.endpoints,
        namespace: this.connection.namespace,
        tlsServerName: this.connection.tlsServerName,
        credentials: {
          type: "approle",
          authPath: this.authPath,
          roleId: this.role.roleId,
          secretId: makeSecretOutput(this.secretId.secretId),
        },
      },
    })
  }

  constructor(name: string, args: AppRoleArgs, opts?: ComponentResourceOptions) {
    super("highstate:vault:AppRole", name, args, opts)

    if (!args.authBackend && (!args.connection || !args.authPath)) {
      throw new Error("AppRole requires either an auth backend or a Vault connection and auth path")
    }

    const authBackend = args.authBackend ? output(args.authBackend) : undefined
    const policies = output(args.policies)

    this.connection = authBackend ? authBackend.connection : output(args.connection!)
    this.authPath = authBackend ? authBackend.authBackend.path : output(args.authPath!)

    this.role = output({ authPath: this.authPath, connection: this.connection, policies }).apply(
      async ({ authPath, connection, policies }) => {
        const provider = await getProvider(connection)

        for (const policy of policies) {
          const policyConnection = await toPromise(policy.connection)

          if (getEntityId(connection) !== getEntityId(policyConnection)) {
            throw new Error(
              "AppRole policies must use the same Vault connection as the auth backend",
            )
          }
        }

        return new approle.AuthBackendRole(
          name,
          {
            backend: authPath,
            roleName: args.roleName ?? name,
            tokenPolicies: policies.map(policy => policy.policy.name),
          },
          mergeOptions(opts, { provider, parent: this }),
        )
      },
    )

    this.secretId = output({
      authPath: this.authPath,
      connection: this.connection,
      role: this.role,
    }).apply(async ({ authPath, connection, role }) => {
      const provider = await getProvider(connection)

      return new approle.AuthBackendRoleSecretId(
        name,
        {
          backend: authPath,
          roleName: role.roleName,
        },
        mergeOptions(opts, { provider, parent: this }),
      )
    })
  }
}
