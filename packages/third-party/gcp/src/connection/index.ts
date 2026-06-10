import { gcp } from "@highstate/library"
import { forUnit, makeEntityOutput, toPromise } from "@highstate/pulumi"

const { args, secrets, outputs } = forUnit(gcp.connection)

type ServiceAccountKeyFile = {
  project_id: string
  client_email: string
}

const keyFileString = await toPromise(secrets.serviceAccountKeyJson)
const keyFileData: ServiceAccountKeyFile = JSON.parse(keyFileString)

if (!keyFileData.project_id) {
  throw new Error("Could not determine project ID from service account key")
}

const connection = makeEntityOutput({
  entity: gcp.connectionEntity,
  identity: keyFileData.project_id,
  meta: {
    title: keyFileData.project_id,
    description: `Authorized as SA ${keyFileData.client_email}`,
  },
  value: {
    serviceAccountKeyJson: secrets.serviceAccountKeyJson,
    projectId: keyFileData.project_id,
    defaultRegion: args.region.id,
    defaultZone: args.region.defaultZone,
  },
})

export default outputs({
  connection,

  $statusFields: {
    projectId: {
      meta: {
        icon: "mdi:cloud",
      },
      value: connection.projectId,
    },
    defaultRegion: {
      meta: {
        icon: "mdi:map-marker-radius",
      },
      value: connection.defaultRegion,
    },
  },
})
