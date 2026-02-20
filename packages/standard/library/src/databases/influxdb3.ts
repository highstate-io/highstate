import { defineEntity, defineUnit, type EntityInput, z } from "@highstate/contract"
import { l4EndpointEntity, l7EndpointEntity } from "../network"

export const credentialsSchema = z.object({
  /**
   * The token for authenticating to the InfluxDB 3 instance.
   */
  token: z.string(),
})

/**
 * Represents a connection to a InfluxDB 3 instance, including the endpoints and credentials.
 */
export const connectionEntity = defineEntity({
  type: "influxdb3.connection.v1",

  includes: {
    endpoints: {
      entity: l7EndpointEntity,
      multiple: true,
    },
  },

  schema: z.object({
    /**
     * The credentials for authenticating to the InfluxDB 3 instance.
     */
    credentials: credentialsSchema,
  }),
})

/**
 * Represents an InfluxDB 3 database with credentials and endpoints to access it.
 */
export const databaseEntity = defineEntity({
  type: "influxdb3.database.v1",

  includes: {
    endpoints: {
      entity: l7EndpointEntity,
      multiple: true,
    },
  },

  schema: z.object({
    /**
     * The name of the database.
     */
    name: z.string(),

    /**
     * The credentials that can be used to access the database.
     */
    credentials: credentialsSchema,
  }),

  meta: {
    color: "#22adf6",
  },
})

/**
 * Creates a database in an InfluxDB 3 instance.
 */
export const database = defineUnit({
  type: "influxdb3.database.v1",

  args: {
    /**
     * The name of the database.
     *
     * If not provided, it will be set to the unit name.
     */
    databaseName: z.string().optional(),

    /**
     * The retention period for the database.
     *
     * The value is passed through to InfluxDB 3 as-is.
     */
    retention_period: z.string().optional(),
  },

  inputs: {
    connection: connectionEntity,
  },

  outputs: {
    database: databaseEntity,
  },

  meta: {
    title: "InfluxDB 3 Database",
    icon: "simple-icons:influxdb",
    category: "Databases",
  },

  source: {
    package: "@highstate/influxdb3",
    path: "units/database",
  },
})

export type Connection = z.infer<typeof connectionEntity.schema>
export type ConnectionInput = EntityInput<typeof connectionEntity>
export type Database = z.infer<typeof databaseEntity.schema>
export type DatabaseInput = EntityInput<typeof databaseEntity>
