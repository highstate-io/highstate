import { dns } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { updateEndpointsWithFqdn } from "../../../shared"

const { args, inputs, outputs } = forUnit(dns.recordSet)

const { endpoints: l3Endpoints } = await updateEndpointsWithFqdn(
  inputs.l3Endpoints ?? [],
  args.fqdn,
  args.endpointFilter,
  args.patchMode,
  inputs.dnsProviders,
)

const { endpoints: l4Endpoints } = await updateEndpointsWithFqdn(
  inputs.l4Endpoints ?? [],
  args.fqdn,
  args.endpointFilter,
  args.patchMode,
  inputs.dnsProviders,
)

export default outputs({
  l3Endpoints,
  l4Endpoints,
})
