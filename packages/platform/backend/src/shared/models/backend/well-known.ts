import type {
  BackendRoleCreateInput,
  BackendServiceAccountCreateInput,
  LibraryCreateInput,
  ProjectModelStorageCreateInput,
  ProjectSpaceCreateInput,
  PulumiBackendCreateInput,
} from "../../../database"
import { backendPermissionGroups } from "./role"

export const adminBackendRole = {
  systemName: "admin",
  meta: {
    title: "Admin",
    description: "Grants unrestricted access to every backend permission.",
  },
  rules: [
    {
      permissions: backendPermissionGroups.flatMap(group =>
        group.permissions.map(permission => permission.name),
      ),
    },
  ],
} satisfies BackendRoleCreateInput

export const adminBackendServiceAccount = {
  systemName: "admin",
  meta: {
    title: "Admin",
    description: "System-managed backend administrator identity.",
    icon: "mdi:shield-crown-outline",
  },
} satisfies BackendServiceAccountCreateInput

export const globalProjectSpace = {
  id: "q8xbilhwpsn65zjlv5kz44qh",
  meta: {
    title: "Global Project Space",
    description: "The default project space for all projects.",
    icon: "mdi-earth",
    iconColor: "#4CAF50",
  },
} satisfies ProjectSpaceCreateInput

export const codebaseLibrary = {
  id: "n0rfvpl9o77iqf29ff4kk5gf",
  meta: {
    title: "Codebase Library",
    description:
      "The library which loads components and entities from packages (local or NPM-installed) in the codebase.",
    icon: "mdi-package-variant",
    iconColor: "#2196F3",
  },
  spec: { type: "host" },
} satisfies LibraryCreateInput

export const hostPulumiBackend = {
  id: "pmn9y901jeiz2ydh93045l39",
  meta: {
    title: "Host Pulumi Backend",
    description: "The Pulumi backend which will always use the Pulumi CLI configured on the host.",
  },
  spec: { type: "host" },
} satisfies PulumiBackendCreateInput

export const codebaseProjectModelStorage = {
  id: "qppfcerovu3h22o0x8rlpc3g",
  meta: {
    title: "Codebase Model Storage",
    description: "The storage which stores project model in the codebase.",
    icon: "mdi-code-json",
  },
  spec: { type: "codebase" },
} satisfies ProjectModelStorageCreateInput

export const databaseProjectModelStorage = {
  id: "rmi0hmo1tjjsyfry9l178fus",
  meta: {
    title: "Database Model Storage",
    description:
      "The storage which stores project model in the database alongside the project state.",
    icon: "mdi-database",
  },
  spec: { type: "database" },
} satisfies ProjectModelStorageCreateInput
