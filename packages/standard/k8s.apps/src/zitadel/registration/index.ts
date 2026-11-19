import { oauth, zitadel } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"
import { applicationCallback } from "./provider"
import { OidcApplication } from "./resource"

const { name, args, inputs, stateId, outputs } = forUnit(zitadel.oidcApplication)

const application = new OidcApplication(name, {
  issuer: inputs.management.issuer,
  token: inputs.management.token.value,
  organizationId: args.organizationId,
  projectId: args.projectId,
  name: args.applicationName,
  redirectUris: [applicationCallback(args.fqdn, args.callbackPath)],
})

const provider = makeEntityOutput({
  entity: oauth.providerEntity,
  identity: stateId,
  value: {
    identity: { protocol: "oidc", issuer: inputs.management.issuer, groups: args.groups },
    clientAuthMethod: "client_secret_basic",
    scopes: args.scopes,
  },
})

export default outputs({
  provider,
  registration: makeEntityOutput({
    entity: oauth.registrationEntity,
    identity: stateId,
    value: { provider, clientId: application.clientId, clientSecret: application.clientSecret },
  }),
})
