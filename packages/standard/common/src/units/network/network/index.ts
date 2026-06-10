import { network } from "@highstate/library"
import { forUnit, makeEntityOutput, toPromise } from "@highstate/pulumi"
import { parseSubnets, subnetToString } from "../../../shared"

const { name, stateId, args, inputs, outputs } = forUnit(network.network)

const resolvedInputNetworks = await toPromise(inputs.subnets)
const parsedSubnets = await parseSubnets(
  args.subnets,
  resolvedInputNetworks.flatMap(subnetNetwork => subnetNetwork.subnets),
)

export default outputs({
  network: makeEntityOutput({
    entity: network.networkEntity,
    identity: args.identity ?? stateId,
    meta: {
      title: args.entityMeta.title ?? name,
      description: args.entityMeta.description,
      icon: args.entityMeta.icon,
      iconColor: args.entityMeta.iconColor,
    },
    value: {
      subnets: parsedSubnets,
    },
  }),

  $statusFields: {
    subnets: parsedSubnets.map(subnetToString),
  },
})
