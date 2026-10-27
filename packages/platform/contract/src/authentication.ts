import { z } from "zod"

const httpUrlSchema = z.url().refine(url => ["http:", "https:"].includes(new URL(url).protocol), {
  message: "Expected an HTTP or HTTPS URL",
})

/**
 * A dot-separated own-property path into a JSON profile or verified ID token.
 * Numeric segments address arrays; prototype traversal and executable expressions are forbidden.
 */
export const loginFieldPathSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/)
  .refine(
    path => !path.split(".").some(part => ["__proto__", "prototype", "constructor"].includes(part)),
    {
      message: "Prototype traversal is not allowed",
    },
  )

/**
 * Subject values may be nonempty strings or finite numbers converted to decimal strings.
 * Other scalar fields must be strings; groups must be an array of strings.
 * Missing optional fields are ignored and no arbitrary value conversions are supported.
 */
export const loginProfileMappingSchema = z.object({
  subject: loginFieldPathSchema,
  name: loginFieldPathSchema.optional(),
  username: loginFieldPathSchema.optional(),
  email: loginFieldPathSchema.optional(),
  avatar: loginFieldPathSchema.optional(),
  groups: loginFieldPathSchema.optional(),
})

/**
 * OIDC identity is the verified issuer and subject, with optional claims from the verified ID token.
 * OAuth2 identity is the configured stable authority and mapped UserInfo subject.
 * Email and username are display attributes, never identity keys.
 */
export const loginIdentitySchema = z.discriminatedUnion("protocol", [
  z.object({
    protocol: z.literal("oidc"),
    issuer: httpUrlSchema,
    groups: loginFieldPathSchema.optional(),
  }),
  z.object({
    protocol: z.literal("oauth2"),
    authority: z.string().min(1),
    userInfoUrl: httpUrlSchema,
    mapping: loginProfileMappingSchema,
  }),
])

export const oauthClientAuthMethodSchema = z.enum([
  "client_secret_basic",
  "client_secret_post",
  "none",
])

/**
 * Runtime login configuration shared by deployment adapters and authentication consumers.
 * Credentials are plain strings here; infrastructure entities wrap them as secrets.
 * OIDC endpoints may be discovered from the issuer; OAuth2 endpoints must be explicit.
 * Consumers must use a maintained OAuth/OIDC client for protocol validation.
 */
export const loginProviderConfigSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    title: z.string().min(1),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1).optional(),
    authorizationEndpoint: httpUrlSchema.optional(),
    tokenEndpoint: httpUrlSchema.optional(),
    clientAuthMethod: oauthClientAuthMethodSchema.default("client_secret_basic"),
    identity: loginIdentitySchema,
    scopes: z.array(z.string().min(1)).default([]),
  })
  .superRefine((config, ctx) => {
    if (config.identity.protocol === "oauth2") {
      for (const field of ["authorizationEndpoint", "tokenEndpoint"] as const) {
        if (!config[field]) {
          ctx.addIssue({ code: "custom", path: [field], message: "Required for OAuth2 providers" })
        }
      }
    }

    if (config.clientAuthMethod !== "none" && !config.clientSecret) {
      ctx.addIssue({
        code: "custom",
        path: ["clientSecret"],
        message: "Required for client authentication",
      })
    }
  })

export type LoginFieldPath = z.infer<typeof loginFieldPathSchema>
export type LoginProfileMapping = z.infer<typeof loginProfileMappingSchema>
export type LoginIdentity = z.infer<typeof loginIdentitySchema>
export type OAuthClientAuthMethod = z.infer<typeof oauthClientAuthMethodSchema>
export type LoginProviderConfig = z.infer<typeof loginProviderConfigSchema>
