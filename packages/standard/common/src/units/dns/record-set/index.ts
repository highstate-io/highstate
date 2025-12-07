import { dns } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { updateEndpointsWithFqdn } from "../../../shared"

const { name, args, inputs, outputs } = forUnit(dns.recordSet)

const { endpoints: l3Endpoints } = await updateEndpointsWithFqdn(
  inputs.l3Endpoints ?? [],
  args.fqdn ?? name,
  args.endpointFilter,
  args.patchMode,
  inputs.dnsProviders,
  `${args.fqdn ?? name}-l3`,
)

const { endpoints: l4Endpoints } = await updateEndpointsWithFqdn(
  inputs.l4Endpoints ?? [],
  args.fqdn ?? name,
  args.endpointFilter,
  args.patchMode,
  inputs.dnsProviders,
  `${args.fqdn ?? name}-l4`,
)

export default outputs({
  l3Endpoints,
  l4Endpoints,
})
