import type { PermissionRisk } from "@highstate/backend/shared"

export type RoleRuleBuilderOption = {
  id: string
  title: string
}

export type RoleRuleBuilderPermission = {
  name: string
  title: string
  risk: PermissionRisk
}

export type RoleRuleBuilderGroup = {
  id: string
  title: string
  permissions: RoleRuleBuilderPermission[]
  supportedRestrictions: string[]
  resourceType?: string
}

export type RoleRuleBuilderRestrictionDescriptor = {
  id: string
  title: string
  recursive?: boolean
}

export type RoleRuleBuilderRestriction = {
  type: string
  ids: string[]
  recursive?: boolean
}

export type RoleRuleBuilderRule = {
  groupId: string
  permissions: string[]
  restrictions: RoleRuleBuilderRestriction[]
}
