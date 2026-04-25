import { generatePassword } from "@highstate/common"
import { postgresql } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { Database, Role } from "../../shared"

const { name, args, inputs, getSecret, outputs } = forUnit(postgresql.database)

const databaseName = args.databaseName ?? name
const username = args.username ?? databaseName
const password = getSecret("password", generatePassword)

const role = new Role(username, { connection: inputs.connection, password })

const database = new Database(databaseName, {
  connection: inputs.connection,
  owner: role,
  lcCollate: args.lcCollate,
  lcCtype: args.lcCtype,
})

export default outputs({
  connection: database.authenticatedConnection,
})
