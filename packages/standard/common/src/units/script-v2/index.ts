import { getEntityId } from "@highstate/contract"
import { common } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { Command } from "../../shared"

const { args, inputs, outputs } = forUnit(common.scriptV2)

const servers = await toPromise(inputs.servers)

for (const server of servers) {
  new Command(`${getEntityId(server)}-${server.hostname}`, {
    host: server,
    create: args.script,
    update: args.updateScript,
    delete: args.deleteScript,
    ignoreCommandChanges: false,
  })
}

export default outputs({
  servers,
})
