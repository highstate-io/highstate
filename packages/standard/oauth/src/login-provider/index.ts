import { loginProviderConfigSchema } from "@highstate/contract"
import { oauth } from "@highstate/library"
import { forUnit, makeEntityOutput, toPromise } from "@highstate/pulumi"

const { args, inputs, stateId, outputs } = forUnit(oauth.loginProvider)
const registration = await toPromise(inputs.registration)
const value = {
  ...registration.provider,
  ...args,
  clientId: registration.clientId,
  clientSecret: registration.clientSecret,
}

loginProviderConfigSchema.parse({
  ...value,
  clientId: value.clientId.value,
  clientSecret: value.clientSecret?.value,
})

export default outputs({
  loginProvider: makeEntityOutput({ entity: oauth.loginProviderEntity, identity: stateId, value }),
})
