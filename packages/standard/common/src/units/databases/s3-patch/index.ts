import { databases } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { l4EndpointToString, parseEndpoints } from "../../../shared"

const { args, inputs, outputs } = forUnit(databases.s3Patch)

const s3 = await toPromise(inputs.s3)
const resolvedInputEndpoints = await toPromise(inputs.endpoints ?? [])

const shouldOverrideEndpoints =
  args.endpoints.length > 0 || resolvedInputEndpoints.some(endpoint => endpoint != null)
const endpoints = shouldOverrideEndpoints
  ? await parseEndpoints(args.endpoints, inputs.endpoints, 4)
  : s3.endpoints

export default outputs({
  s3: {
    ...s3,
    endpoints,
    region: args.region ?? s3.region,
    accessKey: args.accessKey ?? s3.accessKey,
    buckets: args.buckets ?? s3.buckets,
  },

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },
})
