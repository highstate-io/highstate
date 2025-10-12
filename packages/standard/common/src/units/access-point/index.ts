import { common } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"

const { args, inputs, outputs } = forUnit(common.accessPoint)

export default outputs({
  accessPoint: {
    gateway: inputs.gateway,
    tlsIssuers: inputs.tlsIssuers ?? [],
    dnsProviders: inputs.dnsProviders ?? [],
    proxied: args.proxied,
  },
})
