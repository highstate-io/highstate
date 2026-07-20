import type { rustfs } from "@highstate/library"
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
   * The RustFS instance where the service account should be created.
   */
  connection: Input<rustfs.Connection>

  /**
   * The parent access key that owns the service account.
   */
  user: Input<string>

  /**
   * The policy to restrict the service account with.
   */
  policy: Input<Record<string, unknown>>
}

export class ServiceAccount extends ComponentResource {
  /**
   * The underlying RustFS service account resource.
   */
  readonly serviceAccount: Output<IamServiceAccount>

  constructor(name: string, args: ServiceAccountArgs, opts?: ComponentResourceOptions) {
    super("highstate:rustfs:ServiceAccount", name, args, opts)

    this.serviceAccount = output(args.connection).apply(async connection => {
      const provider = await getProvider(connection)

      return new IamServiceAccount(
        name,
        {
          targetUser: args.user,
          policy: output(args.policy).apply(JSON.stringify),
        },
        {
          ...opts,
          provider,
          parent: this,
        },
      )
    })
  }
}
