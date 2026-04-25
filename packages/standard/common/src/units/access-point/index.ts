import { common } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"

const { name, stateId, args, inputs, outputs } = forUnit(common.accessPoint)

export default outputs({
  accessPoint: makeEntityOutput({
    entity: common.accessPointEntity,
    identity: stateId,
    meta: {
      title: name,
    },
    value: {
      gateway: inputs.gateway,
      tlsIssuers: inputs.tlsIssuers ?? [],
      dnsProviders: inputs.dnsProviders ?? [],
      proxied: args.proxied,
    },
  }),
})
