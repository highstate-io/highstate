import { forUnit, makeEntityOutput } from "@highstate/pulumi"
import { marker, markerEntity } from "../library"
import { MarkerResource } from "../provider"

const { name, args, outputs } = forUnit(marker)
const resource = new MarkerResource(name, args, "__IMPLEMENTATION_MARKER__")

export default outputs({
  marker: makeEntityOutput({
    entity: markerEntity,
    identity: args.key,
    value: { marker: resource.marker, value: resource.value },
  }),
})
