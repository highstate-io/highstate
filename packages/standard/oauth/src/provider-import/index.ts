import { oauth } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"

const { args, stateId, outputs } = forUnit(oauth.providerImport)

if (args.identity.protocol === "oauth2" && (!args.authorizationEndpoint || !args.tokenEndpoint)) {
  throw new Error("OAuth2 providers require authorization and token endpoints")
}

export default outputs({
  provider: makeEntityOutput({ entity: oauth.providerEntity, identity: stateId, value: args }),
})
