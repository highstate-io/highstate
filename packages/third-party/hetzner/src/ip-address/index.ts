import { hetzner } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"
import { FloatingIp, PrimaryIp } from "@pulumi/hcloud"
import { createProvider } from "../provider"

const { name, args, inputs, outputs } = forUnit(hetzner.ipAddress)

const addressName = args.addressName ?? name
const location = args.location ?? inputs.connection.defaultLocation
const provider = await createProvider(inputs.connection)

const address =
  args.kind === "primary"
    ? new PrimaryIp(
        "ip-address",
        {
          name: addressName,
          location,
          type: args.type,
          autoDelete: false,
          labels: {
            "managed-by": "highstate",
          },
        },
        { provider },
      )
    : new FloatingIp(
        "ip-address",
        {
          name: addressName,
          homeLocation: location,
          type: args.type,
          labels: {
            "managed-by": "highstate",
          },
        },
        { provider },
      )

const ipAddress = makeEntityOutput({
  entity: hetzner.ipAddressEntity,
  identity: address.id,
  meta: {
    title: addressName,
  },
  value: {
    id: address.id,
    name: addressName,
    kind: args.kind,
    type: args.type,
    address: address.ipAddress,
    network: args.type === "ipv6" ? address.ipNetwork : undefined,
    location,
  },
})

export default outputs({
  ipAddress,

  $statusFields: {
    id: address.id,
    address: address.ipAddress,
    kind: args.kind,
    type: args.type,
    location,
  },
})
