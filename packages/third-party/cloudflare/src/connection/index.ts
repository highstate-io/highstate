import { cloudflare } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { getZones, Provider } from "@pulumi/cloudflare"

const { instanceId, secrets, outputs } = forUnit(cloudflare.connection)

const provider = new Provider("cloudflare", { apiToken: secrets.apiToken })
const { results: zones } = await getZones({}, { provider })

if (!zones.length) {
  throw new Error(
    "No zones found with the provided API token. Ensure the token has Zone.Zone:Read permission on the zone.",
  )
}

export default outputs({
  dnsProvider: {
    id: `cloudflare.${instanceId}`,
    zones: zones.map(zone => zone.name),

    implRef: {
      package: "@highstate/cloudflare",
      data: {
        zoneId: zones[0].id,
        apiToken: secrets.apiToken,
      },
    },
  },
  $statusFields: {
    zones: zones.map(zone => zone.name),
  },
})
