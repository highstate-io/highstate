import { zitadel } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"

const { args, secrets, stateId, outputs } = forUnit(zitadel.managementImport)

export default outputs({
  management: makeEntityOutput({
    entity: zitadel.managementEntity,
    identity: stateId,
    value: { issuer: args.issuer.replace(/\/$/, ""), token: secrets.token },
  }),
})
