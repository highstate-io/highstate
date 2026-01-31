import { databases } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { l4EndpointToString, parseEndpoints } from "../../../shared"

const { args, inputs, outputs } = forUnit(databases.etcdPatch)

const resolvedInputEndpoints = await toPromise(inputs.endpoints ?? [])

const shouldOverrideEndpoints =
  args.endpoints.length > 0 || resolvedInputEndpoints.some(endpoint => endpoint != null)
const endpoints = shouldOverrideEndpoints
  ? await parseEndpoints(args.endpoints, inputs.endpoints, 4)
  : await parseEndpoints([], inputs.endpoints, 4)

export default outputs({
  etcd: {
    endpoints,
  },

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },
})
