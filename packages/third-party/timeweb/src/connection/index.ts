import { timeweb } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"

const { stateId, name, secrets, outputs } = forUnit(timeweb.connection)

export default outputs({
  connection: makeEntityOutput({
    entity: timeweb.connectionEntity,
    identity: stateId,
    meta: {
      title: name,
    },
    value: {
      name,
      apiToken: secrets.apiToken,
    },
  }),
})
