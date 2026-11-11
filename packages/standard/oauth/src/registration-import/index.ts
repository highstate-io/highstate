import { oauth } from "@highstate/library"
import { forUnit, makeEntityOutput, toPromise } from "@highstate/pulumi"

const { inputs, secrets, stateId, outputs } = forUnit(oauth.registrationImport)
const provider = await toPromise(inputs.provider)

if (provider.clientAuthMethod !== "none" && !(await toPromise(secrets.clientSecret))) {
  throw new Error("Client authentication requires a client secret")
}

export default outputs({
  registration: makeEntityOutput({
    entity: oauth.registrationEntity,
    identity: stateId,
    value: { provider, clientId: secrets.clientId, clientSecret: secrets.clientSecret },
  }),
})
