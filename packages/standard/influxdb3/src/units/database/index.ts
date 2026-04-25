import { influxdb3 } from "@highstate/library"
import { forUnit, getCombinedIdentityOutput, makeEntityOutput } from "@highstate/pulumi"
import { ResourceToken } from "../../shared"
import { Database } from "../../shared/database"

const { name, args, inputs, outputs } = forUnit(influxdb3.database)

const dbName = args.databaseName ?? name

const database = new Database(dbName, {
  connection: inputs.connection,
  retention_period: args.retention_period,
})

const token = new ResourceToken(
  `${dbName}-rw`,
  {
    connection: inputs.connection,
    permissions: [
      {
        resource_type: "db",
        actions: ["read", "write"],
        resource_names: [dbName],
      },
    ],
  },
  { dependsOn: database.command },
)

const databaseEntity = makeEntityOutput({
  entity: influxdb3.databaseEntity,
  identity: getCombinedIdentityOutput([inputs.connection, dbName]),
  meta: {
    title: dbName,
  },
  value: {
    name: dbName,
    endpoints: inputs.connection.endpoints,
    credentials: {
      token: token.token,
    },
  },
})

export default outputs({
  database: databaseEntity,

  $statusFields: {
    token: token.token,
  },
})
