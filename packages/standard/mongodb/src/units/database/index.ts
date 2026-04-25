import { generatePassword } from "@highstate/common"
import { mongodb } from "@highstate/library"
import {
  forUnit,
  getCombinedIdentityOutput,
  makeEntityOutput,
  makeSecretOutput,
} from "@highstate/pulumi"
import { User } from "../../shared"

const { name, args, inputs, getSecret, outputs } = forUnit(mongodb.database)

const databaseName = args.databaseName ?? name
const username = args.username ?? databaseName
const password = getSecret("password", generatePassword)

new User(username, {
  connection: inputs.connection,
  password,
  roles: [{ db: databaseName, role: "dbAdmin" }],
})

export default outputs({
  connection: makeEntityOutput({
    entity: mongodb.connectionEntity,
    identity: getCombinedIdentityOutput([inputs.connection, databaseName]),
    meta: {
      title: databaseName,
    },
    value: {
      endpoints: inputs.connection.endpoints,
      credentials: {
        type: "password",
        username,
        password: makeSecretOutput(password),
      },
      database: databaseName,
    },
  }),
})
