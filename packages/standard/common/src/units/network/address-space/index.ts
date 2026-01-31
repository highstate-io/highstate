import { network } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { createAddressSpace, subnetToString } from "../../../shared"

const { args, inputs, outputs } = forUnit(network.addressSpace)

const resolvedInputs = await toPromise(inputs)

const addressSpace = createAddressSpace({
  included: [...args.included, ...resolvedInputs.included],
  excluded: [...args.excluded, ...resolvedInputs.excluded],
})

export default outputs({
  addressSpace,

  $statusFields: {
    subnets: addressSpace.subnets.map(subnetToString),
  },
})
