import {
  defineEntity,
  defineUnit,
  type EntityInput,
  type EntityValue,
  loginIdentitySchema,
  loginProviderConfigSchema,
  secretSchema,
  z,
} from "@highstate/contract"

const config = loginProviderConfigSchema.shape
const meta = { title: "OAuth Provider", icon: "mdi:shield-key", category: "Authentication" }
const registrationSecrets = {
  clientId: config.clientId,
  clientSecret: z.string().min(1).optional(),
}

export const providerSchema = z.object({
  authorizationEndpoint: config.authorizationEndpoint,
  tokenEndpoint: config.tokenEndpoint,
  clientAuthMethod: config.clientAuthMethod,
  identity: loginIdentitySchema,
  scopes: config.scopes,
})

export const providerEntity = defineEntity({
  type: "oauth.provider.v1",
  schema: providerSchema,
  meta,
})

export const registrationSchema = z.object({
  provider: providerSchema,
  clientId: secretSchema(config.clientId),
  clientSecret: secretSchema(z.string().min(1)).optional(),
})

export const registrationEntity = defineEntity({
  type: "oauth.registration.v1",
  schema: registrationSchema,
  meta: { ...meta, title: "OAuth Registration" },
})

/**
 * Deployments unwrap both credentials and validate the result with loginProviderConfigSchema.
 * The ID is stable across credential rotation and display-title changes.
 */
export const loginProviderEntity = defineEntity({
  type: "auth.login-provider.v1",
  schema: z.object({
    ...config,
    clientId: registrationSchema.shape.clientId,
    clientSecret: registrationSchema.shape.clientSecret,
  }),
  meta: { ...meta, title: "Login Provider" },
})

/** Imports endpoint and identity settings for an existing OAuth2 or OIDC provider. */
export const providerImport = defineUnit({
  type: "oauth.provider-import.v1",
  args: providerSchema.shape,
  outputs: { provider: providerEntity },
  meta: { ...meta, title: "Import OAuth Provider" },
  source: { package: "@highstate/oauth", path: "provider-import" },
})

/** Imports an existing client registration without creating or rotating credentials. */
export const registrationImport = defineUnit({
  type: "oauth.registration-import.v1",
  inputs: { provider: providerEntity },
  secrets: registrationSecrets,
  outputs: { registration: registrationEntity },
  meta: { ...meta, title: "Import OAuth Registration" },
  source: { package: "@highstate/oauth", path: "registration-import" },
})

/** Adapts an existing registration into a deployment-independent login capability. */
export const loginProvider = defineUnit({
  type: "auth.login-provider.v1",
  args: { id: config.id, title: config.title },
  inputs: { registration: registrationEntity },
  outputs: { loginProvider: loginProviderEntity },
  meta: { ...meta, title: "Login Provider" },
  source: { package: "@highstate/oauth", path: "login-provider" },
})

/** Imports an existing OIDC client using issuer discovery. */
export const oidcRegistrationImport = defineUnit({
  type: "oauth.oidc-registration-import.v1",
  args: {
    issuer: loginIdentitySchema.options[0].shape.issuer,
    groups: loginIdentitySchema.options[0].shape.groups,
    scopes: config.scopes.default(["openid", "profile", "email"]),
    clientAuthMethod: config.clientAuthMethod,
  },
  secrets: registrationSecrets,
  outputs: { provider: providerEntity, registration: registrationEntity },
  meta: { ...meta, title: "Import OIDC Registration" },
  source: { package: "@highstate/oauth", path: "oidc-registration-import" },
})

/** Imports a manually registered GitHub OAuth App without changing its registration. */
export const githubRegistrationImport = defineUnit({
  type: "github.oauth-registration-import.v1",
  args: { scopes: config.scopes.default(["read:user", "user:email"]) },
  secrets: { clientId: config.clientId, clientSecret: z.string().min(1) },
  outputs: { provider: providerEntity, registration: registrationEntity },
  meta: { ...meta, title: "Import GitHub OAuth Registration", icon: "simple-icons:github" },
  source: { package: "@highstate/oauth", path: "github-registration-import" },
})

export type Provider = EntityValue<typeof providerEntity>
export type ProviderInput = EntityInput<typeof providerEntity>
export type Registration = EntityValue<typeof registrationEntity>
export type RegistrationInput = EntityInput<typeof registrationEntity>
export type LoginProvider = EntityValue<typeof loginProviderEntity>
export type LoginProviderInput = EntityInput<typeof loginProviderEntity>
