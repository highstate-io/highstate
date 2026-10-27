import type { DesignerIdentity } from "@highstate/backend"
import type { LoginProviderConfig } from "@highstate/contract"
import {
  getOAuthUserGroupId,
  getOAuthUserId,
  getOidcUserGroupId,
  getOidcUserId,
} from "@highstate/backend"
import { loginFieldPathSchema } from "@highstate/contract"

export function readLoginField(profile: unknown, path: string): unknown {
  loginFieldPathSchema.parse(path)
  let value = profile
  for (const segment of path.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, segment)) return undefined
    value = (value as Record<string, unknown>)[segment]
  }
  return value
}

export function mapLoginProfile(provider: LoginProviderConfig, profile: unknown): DesignerIdentity {
  const identity = provider.identity
  const mapping =
    identity.protocol === "oidc"
      ? {
          subject: "sub",
          name: "name",
          username: "preferred_username",
          email: "email",
          avatar: "picture",
          groups: identity.groups,
        }
      : identity.mapping
  const rawSubject = readLoginField(profile, mapping.subject)
  const subject =
    identity.protocol === "oauth2" && typeof rawSubject === "number" && Number.isFinite(rawSubject)
      ? String(rawSubject)
      : rawSubject
  if (typeof subject !== "string" || subject.length === 0)
    throw new Error("Missing or invalid login subject")
  const stringField = (path: string | undefined) => {
    const value = path ? readLoginField(profile, path) : undefined
    return typeof value === "string" && value.length > 0 ? value : undefined
  }
  const groups = mapping.groups ? readLoginField(profile, mapping.groups) : []
  if (
    groups !== undefined &&
    (!Array.isArray(groups) || groups.some(group => typeof group !== "string" || !group))
  )
    throw new Error("Invalid login groups")
  const authority = identity.protocol === "oidc" ? identity.issuer : identity.authority
  const userId = identity.protocol === "oidc" ? getOidcUserId : getOAuthUserId
  const groupId = identity.protocol === "oidc" ? getOidcUserGroupId : getOAuthUserGroupId
  return {
    id: userId(authority, subject),
    type: identity.protocol === "oidc" ? "oidc" : "oauth",
    meta: {
      title: stringField(mapping.name) ?? stringField(mapping.username) ?? subject,
      username: stringField(mapping.username),
      email: stringField(mapping.email),
      avatarUrl: stringField(mapping.avatar),
    },
    groups: [...new Set((groups ?? []) as string[])].map(group => ({
      id: groupId(authority, group),
      title: group,
    })),
  }
}
