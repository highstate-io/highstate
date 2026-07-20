import { yandex } from "@highstate/library"
import { forUnit, getResourceComment, makeEntityOutput } from "@highstate/pulumi"
import { VpcAddress } from "@highstate/yandex-sdk"
import { createProvider } from "../provider"

const { name, args, inputs, outputs } = forUnit(yandex.publicAddress)

const addressName = args.addressName ?? name
const zone = args.zone ?? inputs.connection.defaultZone

const provider = await createProvider(inputs.connection, args.cloudId)

const address = new VpcAddress(
  "address",
  {
    name: addressName,
    folderId: args.folderId ?? inputs.connection.defaultFolderId,
    description: getResourceComment(),
    externalIpv4Address: {
      zoneId: zone,
    },
  },
  { provider },
)

const publicAddress = makeEntityOutput({
  entity: yandex.publicAddressEntity,
  identity: address.id,
  meta: {
    title: addressName,
  },
  value: {
    id: address.id,
    name: addressName,
    address: address.externalIpv4Address.apply(a => a!.address),
  },
})

export default outputs({
  publicAddress,

  $statusFields: {
    id: address.id,
    address: publicAddress.address,
  },
})
