import { common } from "@highstate/library"
import { forUnit, makeEntityOutput, toPromise } from "@highstate/pulumi"
import { parseEndpoint } from "../../shared"

const { name, stateId, args, inputs, outputs } = forUnit(common.remoteFile)

const resolvedInputs = await toPromise(inputs)
if (!resolvedInputs.endpoint && !args.url) {
  throw new Error("Either 'endpoint' input or 'url' argument must be provided.")
}

const endpoint = parseEndpoint(resolvedInputs.endpoint ?? args.url!, 7)

export default outputs({
  file: makeEntityOutput({
    entity: common.fileEntity,
    identity: stateId,
    meta: {
      title: args.fileName ?? endpoint.path?.split("/").pop() ?? name,
    },
    value: {
      meta: {
        name: args.fileName ?? endpoint.path?.split("/").pop() ?? name,
      },
      content: {
        type: "remote",
        endpoint,
      },
    },
  }),
})
