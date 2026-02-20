import { influxdb3 } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { Database } from "../../provider/database"
import { ResourceToken } from "../../provider"

const { name, args, inputs, outputs } = forUnit(influxdb3.database)

const dbName = args.databaseName ?? name

const database = new Database("database", {
  connection: inputs.connection,
  db: dbName,
  retention_period: args.retention_period,
})

const token = new ResourceToken("token", {
  connection: inputs.connection,
  token_name: `${dbName}-rw`,
  expiry_secs: 60 * 60 * 24 * 365 * 10_000, // effectively no expiry (10k years)
  permissions: [
    {
      resource_type: "db",
      actions: ["read", "write"],
      resource_names: [database.db],
    },
  ],
})

export default outputs({
  database: {
    name: database.db,
    endpoints: inputs.connection.endpoints,
    credentials: {
      token: token.token,
    },
  },

  $statusFields: {
    token: token.token,
  },
})
