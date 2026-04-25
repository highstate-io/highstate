import type { minio } from "@highstate/library"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type Output,
  output,
} from "@highstate/pulumi"
import { IamServiceAccount } from "@pulumi/minio"
import { getProvider } from "./provider"

export type ServiceAccountArgs = {
  /**
   * The connection to the MinIO instance where the service account should be created.
   */
  connection: Input<minio.Connection>

  /**
   * The user to link the service account to.
   */
  user: Input<string>

  /**
   * The policy to attach to the service account.
   */
  policy: Input<Record<string, unknown>>
}

export class ServiceAccount extends ComponentResource {
  /**
   * The connection associated with the service account.
   */
  readonly connection: Output<minio.Connection>

  /**
   * The underlying service account resource of the `@pulumi/minio` provider.
   */
  readonly serviceAccount: Output<IamServiceAccount>

  constructor(name: string, args: ServiceAccountArgs, opts?: ComponentResourceOptions) {
    super("highstate:minio:ServiceAccount", name, args, opts)

    this.connection = output(args.connection)

    this.serviceAccount = this.connection.apply(async connection => {
      const { provider, hooks } = await getProvider(connection)

      return new IamServiceAccount(
        name,
        {
          targetUser: args.user,
          policy: output(args.policy).apply(JSON.stringify),
        },
        {
          ...opts,
          provider,
          hooks,
          parent: this,
        },
      )
    })
  }
}
