import { cloudflare } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { getZones, Provider } from "@pulumi/cloudflare"

const { secrets, outputs } = forUnit(cloudflare.connection)

const provider = new Provider("cloudflare", { apiToken: secrets.apiToken })
const { results: zones } = await getZones({}, { provider })

if (!zones.length) {
  throw new Error(
    "No zones found with the provided API token. Ensure the token has Zone.Zone:Read permission on the zone.",
  )
}

if (zones.length > 1) {
  throw new Error(
    "Multiple zones found with the provided API token, please use separate tokens and connections for each zone.",
  )
}

if (!zones[0].id) {
  throw new Error("Zone ID is missing.")
}

if (!zones[0].name) {
  throw new Error("Zone name is missing.")
}

export default outputs({
  dnsProvider: {
    id: `cloudflare.${zones[0].id}`,
    domain: zones[0].name,

    implRef: {
      package: "@highstate/cloudflare",
      data: {
        zoneId: zones[0].id,
        apiToken: secrets.apiToken,
      },
    },
  },
  $statusFields: {
    domain: {
      value: zones[0].name,
    },
    zoneId: {
      value: zones[0].id,
    },
  },
})
