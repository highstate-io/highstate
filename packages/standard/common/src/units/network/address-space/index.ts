import { network } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { createResolvedAddressSpace, subnetToString } from "../../../shared"

const { args, inputs, outputs } = forUnit(network.addressSpace)

const resolvedInputs = await toPromise(inputs)

const addressSpace = await createResolvedAddressSpace({
  included: [...args.included, ...resolvedInputs.included],
  excluded: [...args.excluded, ...resolvedInputs.excluded],
  ipv4: args.ipv4,
  ipv6: args.ipv6,
})

export default outputs({
  addressSpace,

  $statusFields: {
    subnets: addressSpace.subnets.map(subnetToString),
  },
})
