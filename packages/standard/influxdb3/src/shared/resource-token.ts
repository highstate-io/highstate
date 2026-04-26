import type { influxdb3 } from "@highstate/library"
import { Command, l7EndpointToString, resolveEndpoint } from "@highstate/common"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type InputArray,
  type Output,
  output,
} from "@highstate/pulumi"
import images from "../../assets/images.json"

export type ResourceAction = "read" | "write"

export type TokenPermission = {
  resource_type: "db" | "system"
  resource_names: InputArray<string>
  actions: InputArray<ResourceAction>
}

export type ResourceTokenArgs = {
  /**
   * The connection to the InfluxDB 3 instance.
   */
  connection: Input<influxdb3.Connection>

  /**
   * The name/description of the token.
   * Must be unique in the InfluxDB 3 instance.
   *
   * If not provided, a name of the unit will be used.
   */
  name?: Input<string>

  /**
   * The list of permissions granted by the token.
   */
  permissions: Input<TokenPermission[]>
}

export class ResourceToken extends ComponentResource {
  /**
   * The command used to create the token.
   */
  readonly command: Output<Command>

  /**
   * The created token string.
   */
  readonly token: Output<string>

  constructor(name: string, args: ResourceTokenArgs, opts?: ComponentResourceOptions) {
    super("highstate:influxdb3:ResourceToken", name, args, opts)

    this.command = output(args.connection).apply(async connection => {
      const { endpoint, hooks } = await resolveEndpoint(connection.endpoints)

      return new Command(
        `influxdb3-resource-token-${name}`,
        {
          host: "local",
          image: images.influxdb.image,
          environment: {
            INFLUXDB3_HOST_URL: l7EndpointToString(endpoint),
            INFLUXDB3_AUTH_TOKEN: connection.credentials.token.value,
          },
          // to access forwarded endpoint
          hostNetwork: true,
          create: [
            "create token",
            "--format json",
            "--name",
            args.name ?? name,

            // creating "--permissions" arguments for each combination of resource type, resource name and action
            output(args.permissions).apply(permissions =>
              permissions
                .flatMap(permission => {
                  return permission.resource_names.flatMap(resourceName => {
                    return permission.actions.map(action => {
                      return `--permissions ${permission.resource_type}:${resourceName}:${action}`
                    })
                  })
                })
                .join(" "),
            ),
          ],
          stdin: "yes", // to confirm delete operations
          delete: ["delete token", "--token-name", args.name ?? name],
        },
        { ...opts, hooks: { ...opts?.hooks, ...hooks } },
      )
    })

    this.token = this.command.stdout.apply(stdout => {
      try {
        const response = JSON.parse(stdout) as { token: string }

        return response.token
      } catch (error) {
        throw new Error(`Failed to parse token creation output: ${error}`)
      }
    })
  }
}
