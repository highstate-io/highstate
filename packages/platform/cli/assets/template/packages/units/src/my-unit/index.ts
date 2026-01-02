import { myUnit } from "@{{projectName}}/library"
import { forUnit } from "@highstate/pulumi"

const { inputs, outputs } = forUnit(myUnit)

// In this program you can implement the logic of your custom unit using Pulumi SDK.
// See: https://highstate.io/fundamentals/units

export default outputs({
  server: inputs.server,
})
