import type { Output } from "@highstate/pulumi"
import { yandex } from "@highstate/library"
import { forUnit, output, toPromise } from "@highstate/pulumi"
import { getIamServiceAccount, getResourcemanagerFolder, Provider } from "@highstate/yandex-sdk"

const { args, secrets, outputs } = forUnit(yandex.connection)

// parse service account key file to extract service account ID
interface ServiceAccountKeyFile {
  id: string
  service_account_id: string
  created_at: string
  key_algorithm: string
  public_key: string
  private_key: string
}

const serviceAccountKeyFileString = await toPromise(secrets.serviceAccountKeyFile)
const keyFileData: ServiceAccountKeyFile = JSON.parse(serviceAccountKeyFileString)
const serviceAccountId = keyFileData.service_account_id

// create provider for auto-discovery
const provider = new Provider("yandex", {
  serviceAccountKeyFile: serviceAccountKeyFileString,
  zone: args.defaultZone,
  regionId: args.regionId,
})

// auto-discover service account details to get folder and cloud
const serviceAccount = await getIamServiceAccount(
  {
    serviceAccountId: serviceAccountId,
  },
  { provider },
)

// auto-discover cloud ID from folder
const folder = await getResourcemanagerFolder(
  {
    folderId: serviceAccount.folderId,
  },
  { provider },
)

if (!folder.cloudId) {
  throw new Error("Could not determine cloud ID from folder")
}

const yandexCloud: Output<yandex.Cloud> = output({
  serviceAccountKeyFile: secrets.serviceAccountKeyFile,
  cloudId: folder.cloudId,
  defaultFolderId: serviceAccount.folderId,
  defaultZone: args.defaultZone,
  regionId: args.regionId,
})

export default outputs({
  yandexCloud,

  $statusFields: {
    cloudId: {
      meta: {
        icon: "mdi:cloud",
      },
      value: yandexCloud.cloudId,
    },
    defaultFolderId: {
      meta: {
        icon: "mdi:folder",
      },
      value: yandexCloud.defaultFolderId,
    },
    defaultZone: {
      meta: {
        icon: "mdi:map-marker",
      },
      value: yandexCloud.defaultZone,
    },
  },
})
