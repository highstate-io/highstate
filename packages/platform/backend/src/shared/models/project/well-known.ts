import type { RoleCreateInput, ServiceAccountCreateInput } from "../../../database"
import { projectPermissionGroups } from "./role"

export const adminProjectRole = {
  systemName: "admin",
  meta: {
    title: "Admin",
    description: "Grants unrestricted access to every project permission.",
  },
  rules: [
    {
      permissions: projectPermissionGroups.flatMap(group =>
        group.permissions.map(permission => permission.name),
      ),
    },
  ],
} satisfies RoleCreateInput

export const adminProjectServiceAccount = {
  systemName: "admin",
  meta: {
    title: "Admin",
    description: "System-managed project administrator identity.",
    icon: "mdi:shield-crown-outline",
  },
} satisfies ServiceAccountCreateInput
