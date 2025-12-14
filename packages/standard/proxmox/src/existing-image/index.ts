import { proxmox } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { storage } from "@muhlba91/pulumi-proxmoxve"
import { createProvider } from "../provider"

const { args, inputs, outputs } = forUnit(proxmox.existingImage)

const provider = await createProvider(inputs.proxmoxCluster)

const image = storage.File.get(
  "image",
  args.id,
  {
    datastoreId: inputs.proxmoxCluster.defaultDatastoreId,
    nodeName: inputs.proxmoxCluster.defaultNodeName,
  },
  { provider },
)

export default outputs({
  image: {
    id: image.id,
  },
})
