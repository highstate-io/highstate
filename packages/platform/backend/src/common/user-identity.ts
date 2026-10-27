import { cuidv2d } from "@highstate/contract"

const userNamespace = "0d96408e-9f63-4cc7-b580-eb2efb1d589a"
const userGroupNamespace = "de2f3cba-8a0d-4429-9b5c-542a60285dfa"

export function getLocalUserId(username: string): string {
  return cuidv2d(userNamespace, `local:${username}`)
}

export function getOidcUserId(issuer: string, subject: string): string {
  return cuidv2d(userNamespace, `oidc:${issuer}:${subject}`)
}

export function getOidcUserGroupId(issuer: string, group: string): string {
  return cuidv2d(userGroupNamespace, `oidc:${issuer}:${group}`)
}

export function getOAuthUserId(authority: string, subject: string): string {
  return cuidv2d(userNamespace, JSON.stringify(["oauth2", authority, subject]))
}

export function getOAuthUserGroupId(authority: string, group: string): string {
  return cuidv2d(userGroupNamespace, JSON.stringify(["oauth2", authority, group]))
}
