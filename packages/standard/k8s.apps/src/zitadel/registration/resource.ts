import type { CustomResourceOptions, Input, Output } from "@pulumi/pulumi"
import { Resource } from "@pulumi/pulumi/dynamic"
import { type ApplicationInputs, ApplicationProvider } from "./provider"

export class OidcApplication extends Resource {
  declare readonly clientId: Output<string>
  declare readonly clientSecret: Output<string>

  constructor(
    name: string,
    args: { [K in keyof ApplicationInputs]: Input<ApplicationInputs[K]> },
    opts?: CustomResourceOptions,
  ) {
    super(
      new ApplicationProvider(),
      name,
      { ...args, clientId: undefined, clientSecret: undefined, configurationDrift: undefined },
      {
        ...opts,
        additionalSecretOutputs: [
          ...(opts?.additionalSecretOutputs ?? []),
          "token",
          "clientId",
          "clientSecret",
        ],
      },
    )
  }
}
