import { gcp } from "@highstate/library"
import { forUnit, getResourceComment, makeEntityOutput } from "@highstate/pulumi"
import * as gcpProvider from "@pulumi/gcp"
import { createProvider } from "../provider"

const { name, args, inputs, outputs } = forUnit(gcp.disk)

const provider = await createProvider(inputs.connection)
const diskName = args.diskName ?? name
const zone =
  inputs.connection.defaultZone ??
  (
    await gcpProvider.compute.getZones(
      {
        region: inputs.connection.defaultRegion,
        project: inputs.connection.projectId,
        status: "UP",
      },
      { provider },
    )
  ).names[0]

if (!zone) {
  throw new Error(
    `Could not determine an available zone for region "${inputs.connection.defaultRegion}"`,
  )
}

let kmsKey: gcpProvider.kms.CryptoKey | undefined

if (args.encrypted) {
  const keyRing = new gcpProvider.kms.KeyRing(
    "key-ring",
    {
      name: `${diskName}-disk`,
      location: inputs.connection.defaultRegion,
    },
    { provider },
  )

  kmsKey = new gcpProvider.kms.CryptoKey(
    "key",
    {
      name: `${diskName}-disk`,
      keyRing: keyRing.id,
    },
    { provider },
  )
}

const disk = new gcpProvider.compute.Disk(
  "disk",
  {
    name: diskName,
    description: getResourceComment(),
    zone,
    type: args.type,
    size: args.size,
    diskEncryptionKey: kmsKey ? { kmsKeySelfLink: kmsKey.id } : undefined,
  },
  { provider, protect: true },
)

export default outputs({
  disk: makeEntityOutput({
    entity: gcp.diskEntity,
    identity: disk.id,
    value: {
      id: disk.id,
    },
  }),

  $statusFields: {
    id: disk.id,
  },
})
