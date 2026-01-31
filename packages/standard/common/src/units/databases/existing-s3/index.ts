import { databases } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { parseEndpoints } from "../../../shared"

const { args, secrets, inputs, outputs } = forUnit(databases.existingS3)

export default outputs({
  s3: {
    endpoints: parseEndpoints(args.endpoints, inputs.endpoints, 4),
    region: args.region,
    accessKey: args.accessKey,
    secretKey: secrets.secretKey,
    buckets: args.buckets,
  },
})
