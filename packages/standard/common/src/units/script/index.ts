import { common } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { Command } from "../../shared"

const { name, args, inputs, outputs } = forUnit(common.script)

new Command(name, {
  host: inputs.server,
  create: args.script,
  update: args.updateScript,
  delete: args.deleteScript,
  ignoreCommandChanges: false,
})

const server = await toPromise(inputs.server)

export default outputs({
  server,
})
