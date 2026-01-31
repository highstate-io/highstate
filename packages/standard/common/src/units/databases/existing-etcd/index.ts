import { databases } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { parseEndpoints } from "../../../shared"

const { args, inputs, outputs } = forUnit(databases.existingEtcd)

export default outputs({
  etcd: {
    endpoints: parseEndpoints(args.endpoints, inputs.endpoints, 4),
  },
})
