import type { influxdb3 } from "@highstate/library"
import {
  type CustomResourceOptions,
  dynamic,
  type Input,
  type Output,
  type Unwrap,
} from "@highstate/pulumi"
import { apiRequest } from "./api"

export type DatabaseArgs = {
  /**
   * The connection to the InfluxDB 3 instance.
   */
  connection: Input<influxdb3.Connection>

  /**
   * The database name.
   */
  db: Input<string>

  /**
   * The retention period for the database.
   *
   * The value is passed through to InfluxDB 3 as-is.
   */
  retention_period?: Input<string>
}

class DatabaseProvider implements dynamic.ResourceProvider {
  async create(props: Unwrap<DatabaseArgs>): Promise<dynamic.CreateResult> {
    await apiRequest({
      connection: props.connection,
      method: "POST",
      path: "/api/v3/configure/database",
      body: {
        db: props.db,
        retention_period: props.retention_period,
      },
    })

    return {
      id: props.db,
      outs: {
        connection: props.connection,
        db: props.db,
        retention_period: props.retention_period ?? null,
      },
    }
  }

  async delete(_id: string, props: Unwrap<DatabaseArgs>): Promise<void> {
    await apiRequest({
      connection: props.connection,
      method: "DELETE",
      path: "/api/v3/configure/database",
      queryParams: { db: props.db },
    })
  }

  async diff(
    _id: string,
    olds: Unwrap<DatabaseArgs>,
    news: Unwrap<DatabaseArgs>,
  ): Promise<dynamic.DiffResult> {
    const replaces: string[] = []

    if (olds.db !== news.db) {
      replaces.push("db")
    }

    // biome-ignore lint/suspicious/noDoubleEquals: null == undefined check
    if (olds.retention_period != news.retention_period) {
      replaces.push("retention_period")
    }

    return {
      changes: replaces.length > 0,
      replaces,
      deleteBeforeReplace: true,
    }
  }
}

/**
 * Provisions an InfluxDB 3 database via the Configure Database API.
 */
export class Database extends dynamic.Resource {
  declare readonly db: Output<string>
  declare readonly retention_period: Output<string | null>

  constructor(name: string, args: DatabaseArgs, opts?: CustomResourceOptions) {
    super(new DatabaseProvider(), name, args, opts)
  }
}
