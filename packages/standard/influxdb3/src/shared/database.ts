import type { influxdb3 } from "@highstate/library"
import { Command, l7EndpointToString, resolveEndpoint } from "@highstate/common"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  interpolate,
  type Output,
  output,
} from "@highstate/pulumi"
import * as images from "../../assets/images.json"

export type DatabaseArgs = {
  /**
   * The connection to the InfluxDB 3 instance.
   */
  connection: Input<influxdb3.Connection>

  /**
   * The database name.
   *
   * If not provided, the name of the unit will be used as the database name.
   */
  name?: Input<string>

  /**
   * The retention period for the database.
   *
   * The value is passed through to InfluxDB 3 as-is.
   */
  retention_period?: Input<string>
}

export class Database extends ComponentResource {
  /**
   * The command used to create the database.
   */
  readonly command: Output<Command>

  constructor(name: string, args: DatabaseArgs, opts?: ComponentResourceOptions) {
    super("highstate:influxdb3:Database", name, args, opts)

    this.command = output(args.connection).apply(async connection => {
      const { endpoint, hooks } = await resolveEndpoint(connection.endpoints)

      return new Command(
        `influxdb3-database-${name}`,
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
            "create database",
            args.retention_period ? interpolate`--retention-period ${args.retention_period}` : "",
            args.name ?? name,
          ],
          stdin: "yes", // to confirm delete operations
          delete: ["delete database", args.name ?? name, "--hard-delete now"],
        },
        { ...opts, hooks: { ...opts?.hooks, ...hooks } },
      )
    })
  }
}
