import { generatePassword } from "@highstate/common"
import { getPrefixRangeEnd } from "@highstate/etcd-sdk"
import { etcd } from "@highstate/library"
import { forUnit, getCombinedIdentity, makeEntityOutput } from "@highstate/pulumi"
import { Role, User } from "../../shared"

const { name, args, inputs, getSecret, outputs } = forUnit(etcd.namespace)

const roleName = args.roleName ?? name
const username = args.username ?? roleName
const password = getSecret("password", generatePassword)

const role = new Role(roleName, {
  connection: inputs.connection,

  permissions: await Promise.all(
    args.permissions.map(async permission => {
      let rangeEnd: string | undefined = permission.rangeEnd

      if (!rangeEnd) {
        const prefixRangeEndResult = await getPrefixRangeEnd({ key: permission.prefix })
        rangeEnd = prefixRangeEndResult.rangeEnd
      }

      return {
        key: permission.prefix,
        rangeEnd,
        permission: permission.permission,
      }
    }),
  ),
})

const user = new User(username, {
  connection: inputs.connection,
  name: username,
  password,
  roles: [role.role.name],
})

export default outputs({
  connection: makeEntityOutput({
    entity: etcd.connectionEntity,
    identity: getCombinedIdentity([inputs.connection, roleName]),
    meta: {
      title: roleName,
    },
    value: {
      certificate: inputs.connection.certificate,
      endpoints: inputs.connection.endpoints,
      credentials: {
        type: "password",
        username: user.user.username,
        password,
      },
    },
  }),
})
