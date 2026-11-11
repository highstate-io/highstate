import { readFileSync } from "node:fs"
import { loginProviderConfigSchema, z } from "@highstate/contract"

export const hostedAuthConfigSchema = z.object({
  publicUrl: z.url().refine(value => {
    const url = new URL(value)
    return (
      url.protocol === "https:" &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    )
  }, "Expected an HTTPS origin"),
  providers: z
    .array(loginProviderConfigSchema)
    .min(1)
    .refine(
      providers => new Set(providers.map(provider => provider.id)).size === providers.length,
      "Duplicate provider IDs",
    ),
  adminUserIds: z.array(z.cuid2()).default([]),
  adminGroupIds: z.array(z.cuid2()).default([]),
  sessionLifetimeSeconds: z.number().int().min(60).max(604800).default(28800),
})

export type HostedAuthConfig = z.infer<typeof hostedAuthConfigSchema>

export function isHostedAuth(): boolean {
  const mode = process.env.HIGHSTATE_AUTH_MODE ?? "local"
  if (mode !== "local" && mode !== "hosted") {
    throw new Error("Invalid HIGHSTATE_AUTH_MODE")
  }

  return mode === "hosted"
}

let config: HostedAuthConfig | undefined
export function getHostedAuthConfig(): HostedAuthConfig {
  if (!isHostedAuth()) {
    throw new Error("Hosted authentication is disabled")
  }

  if (config) {
    return config
  }

  if (process.env.HIGHSTATE_AUTH_PROVIDERS && process.env.HIGHSTATE_AUTH_PROVIDERS_FILE) {
    throw new Error("Configure only one provider source")
  }

  const providers =
    process.env.HIGHSTATE_AUTH_PROVIDERS ??
    (process.env.HIGHSTATE_AUTH_PROVIDERS_FILE
      ? readFileSync(process.env.HIGHSTATE_AUTH_PROVIDERS_FILE, "utf8")
      : "[]")

  const parsed = hostedAuthConfigSchema.parse({
    publicUrl: process.env.HIGHSTATE_PUBLIC_URL,
    providers: JSON.parse(providers),
    adminUserIds: JSON.parse(process.env.HIGHSTATE_AUTH_ADMIN_USER_IDS ?? "[]"),
    adminGroupIds: JSON.parse(process.env.HIGHSTATE_AUTH_ADMIN_GROUP_IDS ?? "[]"),
    sessionLifetimeSeconds:
      process.env.HIGHSTATE_AUTH_SESSION_LIFETIME_SECONDS === undefined
        ? undefined
        : Number(process.env.HIGHSTATE_AUTH_SESSION_LIFETIME_SECONDS),
  })

  for (const provider of parsed.providers) {
    const urls = [
      provider.authorizationEndpoint,
      provider.tokenEndpoint,
      provider.identity.protocol === "oidc"
        ? provider.identity.issuer
        : provider.identity.userInfoUrl,
    ]

    if (urls.some(url => url && new URL(url).protocol !== "https:")) {
      throw new Error("Hosted providers require HTTPS")
    }

    if (
      provider.identity.protocol === "oidc" &&
      provider.identity.issuer.includes("/.well-known/")
    ) {
      throw new Error("Configure an issuer, not a discovery URL")
    }
  }

  config = parsed
  return config
}
