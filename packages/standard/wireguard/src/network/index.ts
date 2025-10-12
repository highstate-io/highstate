import { wireguard } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"

const { args, outputs } = forUnit(wireguard.network)

export default outputs({
  network: {
    backend: args.backend,
    ipv6: args.ipv6,
  },
})
