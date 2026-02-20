import { mysql } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"

const { name, args, inputs, secrets, outputs } = forUnit(mysql.database)

const databaseName = args.databaseName ?? name
const username = args.username ?? databaseName
const password = secrets.password ?? inputs.connection.credentials.password

export default outputs({
  database: {
    name: databaseName,
    endpoints: inputs.connection.endpoints,
    credentials: {
      username,
      password,
    },
  },
})
