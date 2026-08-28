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

export const workerProjectRole = {
  systemName: "worker",
  meta: {
    title: "Worker",
    description: "Grants worker service accounts access to manage their runtime resources.",
  },
  rules: [
    {
      permissions: ["worker.manage", "panel.update"],
      restrictions: [{ type: "self" }],
    },
    {
      permissions: ["instance-state.get", "instance-status.update"],
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
