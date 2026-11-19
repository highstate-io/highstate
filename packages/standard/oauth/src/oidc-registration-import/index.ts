import { oauth } from "@highstate/library"
import { forUnit, makeEntityOutput, toPromise } from "@highstate/pulumi"

const { args, secrets, stateId, outputs } = forUnit(oauth.oidcRegistrationImport)

if (args.clientAuthMethod !== "none" && !(await toPromise(secrets.clientSecret))) {
  throw new Error("Client authentication requires a client secret")
}

const provider = makeEntityOutput({
  entity: oauth.providerEntity,
  identity: stateId,
  value: {
    identity: { protocol: "oidc", issuer: args.issuer, groups: args.groups },
    scopes: args.scopes,
    clientAuthMethod: args.clientAuthMethod,
  },
})

export default outputs({
  provider,
  registration: makeEntityOutput({
    entity: oauth.registrationEntity,
    identity: stateId,
    value: { provider, clientId: secrets.clientId, clientSecret: secrets.clientSecret },
  }),
})
