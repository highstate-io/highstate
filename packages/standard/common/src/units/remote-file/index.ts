import { common } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { parseEndpoint } from "../../shared"

const { name, args, inputs, outputs } = forUnit(common.remoteFile)

const resolvedInputs = await toPromise(inputs)
if (!resolvedInputs.endpoint && !args.url) {
  throw new Error("Either 'endpoint' input or 'url' argument must be provided.")
}

const endpoint = parseEndpoint(resolvedInputs.endpoint ?? args.url!, 7)

export default outputs({
  file: {
    meta: {
      name: args.fileName ?? endpoint.path?.split("/").pop() ?? name,
    },
    content: {
      type: "remote",
      endpoint,
    },
  },
})
