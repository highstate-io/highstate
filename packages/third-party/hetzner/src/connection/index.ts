import { hetzner } from "@highstate/library"
import { forUnit, makeEntityOutput, toPromise } from "@highstate/pulumi"
import { getLocations, Provider } from "@pulumi/hcloud"

const { stateId, args, secrets, outputs } = forUnit(hetzner.connection)

const apiToken = await toPromise(secrets.apiToken)
const provider = new Provider("hetzner", { token: apiToken })
const locations = await getLocations({ provider })

if (!locations.locations.some(location => location.name === args.defaultLocation)) {
  throw new Error(`Hetzner Cloud location "${args.defaultLocation}" is not available`)
}

const connection = makeEntityOutput({
  entity: hetzner.connectionEntity,
  identity: stateId,
  meta: {
    title: "Hetzner Cloud",
    description: `Connected to Hetzner Cloud with default location "${args.defaultLocation}"`,
  },
  value: {
    apiToken: secrets.apiToken,
    defaultLocation: args.defaultLocation,
  },
})

export default outputs({
  connection,

  $statusFields: {
    defaultLocation: {
      meta: {
        icon: "mdi:map-marker-radius",
      },
      value: connection.defaultLocation,
    },
  },
})
