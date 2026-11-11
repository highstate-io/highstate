import { oauth } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"

const { args, secrets, stateId, outputs } = forUnit(oauth.githubRegistrationImport)

const provider = makeEntityOutput({
  entity: oauth.providerEntity,
  identity: stateId,
  value: {
    authorizationEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
    clientAuthMethod: "client_secret_post",
    identity: {
      protocol: "oauth2",
      authority: "https://github.com",
      userInfoUrl: "https://api.github.com/user",
      mapping: {
        subject: "id",
        name: "name",
        username: "login",
        email: "email",
        avatar: "avatar_url",
      },
    },
    scopes: args.scopes,
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
