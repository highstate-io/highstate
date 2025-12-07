import type { Output } from "@highstate/pulumi"
import { yandex } from "@highstate/library"
import { forUnit, output, toPromise } from "@highstate/pulumi"
import { getIamServiceAccount, getResourcemanagerFolder, Provider } from "@highstate/yandex-sdk"

const { args, secrets, outputs } = forUnit(yandex.connection)

// parse service account key file to extract service account ID
type ServiceAccountKeyFile = {
  service_account_id: string
}

const serviceAccountKeyFileString = await toPromise(secrets.serviceAccountKeyFile)
const keyFileData: ServiceAccountKeyFile = JSON.parse(serviceAccountKeyFileString)
const serviceAccountId = keyFileData.service_account_id

// create provider for auto-discovery
const provider = new Provider("yandex", {
  serviceAccountKeyFile: serviceAccountKeyFileString,
  zone: args.region.defaultZone,
  regionId: args.region.id,
})

// auto-discover service account details to get folder and cloud
const serviceAccount = await getIamServiceAccount(
  { serviceAccountId: serviceAccountId },
  { provider },
)

// auto-discover cloud ID from folder
const folder = await getResourcemanagerFolder({ folderId: serviceAccount.folderId }, { provider })
if (!folder.cloudId) {
  throw new Error("Could not determine cloud ID from folder")
}

const connection: Output<yandex.Connection> = output({
  serviceAccountKeyFile: secrets.serviceAccountKeyFile,
  cloudId: folder.cloudId,
  defaultFolderId: serviceAccount.folderId,
  defaultZone: args.region.defaultZone,
  regionId: args.region.id,
})

export default outputs({
  connection,

  $statusFields: {
    cloudId: {
      meta: {
        icon: "mdi:cloud",
      },
      value: connection.cloudId,
    },
    defaultFolderId: {
      meta: {
        icon: "mdi:folder",
      },
      value: connection.defaultFolderId,
    },
  },
})
