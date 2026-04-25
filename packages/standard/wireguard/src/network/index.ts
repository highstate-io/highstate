import { wireguard } from "@highstate/library"
import { forUnit, makeEntity } from "@highstate/pulumi"

const { name, stateId, args, outputs } = forUnit(wireguard.network)

export default outputs({
  network: makeEntity({
    entity: wireguard.networkEntity,
    identity: stateId,
    meta: {
      title: name,
    },
    value: {
      backend: args.backend,
      ipv4: args.ipv4,
      ipv6: args.ipv6,
      amnezia: args.amnezia,
    },
  }),
})
