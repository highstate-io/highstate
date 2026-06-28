import { proxmox } from "@highstate/library"
import { getFiles } from "@highstate/proxmox-sdk"
import { forUnit, getCombinedIdentityOutput, makeEntityOutput } from "@highstate/pulumi"
import { createProvider } from "../provider"

const { args, inputs, outputs } = forUnit(proxmox.existingImage)

const provider = await createProvider(inputs.proxmoxCluster)

const { files } = await getFiles(
  {
    datastoreId: inputs.proxmoxCluster.defaultDatastoreId,
    nodeName: inputs.proxmoxCluster.defaultNodeName,
  },
  { provider },
)

const image = files.find(file => file.id === args.id)
if (!image) {
  throw new Error(
    `Image with ID "${args.id}" not found in the datastore "${inputs.proxmoxCluster.defaultDatastoreId}" on node "${inputs.proxmoxCluster.defaultNodeName}".`,
  )
}

export default outputs({
  image: makeEntityOutput({
    entity: proxmox.imageEntity,
    identity: getCombinedIdentityOutput([inputs.proxmoxCluster, image.id]),
    meta: {
      title: image.fileName,
    },
    value: {
      id: image.id,
    },
  }),
})
