import { timeweb } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"

const { name, secrets, outputs } = forUnit(timeweb.connection)

export default outputs({
  connection: {
    name,
    apiToken: secrets.apiToken,
  },
})
