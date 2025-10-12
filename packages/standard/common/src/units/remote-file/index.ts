import { common } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { parseL7Endpoint } from "../../shared"

const { args, inputs, outputs } = forUnit(common.remoteFile)

export default outputs({
  file: {
    meta: {
      name: args.url ? new URL(args.url).pathname.split("/").pop() || "file" : "file",
    },
    content: {
      type: "remote",
      endpoint: inputs.endpoint ? inputs.endpoint : parseL7Endpoint(args.url!),
    },
  },
})
