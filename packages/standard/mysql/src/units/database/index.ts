import { generatePassword } from "@highstate/common"
import { mysql } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { Database, Grant, User } from "../../shared"

const { name, args, getSecret, inputs, outputs } = forUnit(mysql.database)

const databaseName = args.databaseName ?? name
const username = args.username ?? databaseName
const password = getSecret("password", generatePassword)

const database = new Database(databaseName, { connection: inputs.connection })
const user = new User(username, { connection: inputs.connection, password })

const grant = new Grant(`${databaseName}-${username}`, {
  database,
  user,
  privileges: ["ALL"],
})

export default outputs({
  connection: grant.authenticatedConnection,
})
