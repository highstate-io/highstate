import { yandex } from "@highstate/library"
import { forUnit, getResourceComment } from "@highstate/pulumi"
import { ComputeDisk } from "@highstate/yandex-sdk"
import { createProvider } from "../provider"

const { name, args, inputs, outputs } = forUnit(yandex.disk)

const provider = await createProvider(inputs.connection)

const diskName = args.diskName ?? name

const disk = new ComputeDisk(
  "disk",
  {
    name: diskName,
    description: getResourceComment(),
    type: args.type,
    size: args.size,
    allowRecreate: false,
  },
  { provider, protect: true },
)

export default outputs({
  disk: {
    id: disk.id,
  },
  $statusFields: {
    id: disk.id,
  },
})
