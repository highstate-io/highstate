import { cloudflare, dns } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"
import { getZones, Provider } from "@pulumi/cloudflare"

const { stateId, secrets, outputs } = forUnit(cloudflare.connection)

const provider = new Provider("cloudflare", { apiToken: secrets.apiToken })
const { results: zones } = await getZones({}, { provider })

if (!zones.length) {
  throw new Error(
    "No zones found with the provided API token. Ensure the token has Zone.Zone:Read permission on the zone.",
  )
}

export default outputs({
  dnsProvider: makeEntityOutput({
    entity: dns.providerEntity,
    identity: stateId,
    meta: {
      title: zones[0]!.name,
      icon: "simple-icons:cloudflare",
      iconColor: "#F38020",
    },
    value: {
      zones: zones.map(zone => zone.name),

      implRef: {
        package: "@highstate/cloudflare",
        data: {
          zoneIds: Object.fromEntries(zones.map(zone => [zone.name, zone.id])),
          apiToken: secrets.apiToken,
        },
      },
    },
  }),
  $statusFields: {
    zones: zones.map(zone => zone.name),
  },
})
