import type {
  BackendRoleCreateInput,
  BackendServiceAccountCreateInput,
  ContainerRuntimeCreateInput,
  ProjectModelStorageCreateInput,
  ProjectSpaceCreateInput,
  PulumiStateBackendCreateInput,
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

export const localContainerRuntime = {
  id: "local",
  meta: {
    title: "Local Docker",
    description: "Runs project workloads on the local Docker engine.",
  },
  spec: {
    type: "docker",
    local: true,
    engineEndpoint: "unix:///var/run/docker.sock",
    runtimeApiUrl: "https://host.docker.internal:3000",
  },
} satisfies ContainerRuntimeCreateInput

export const localPulumiStateBackend = {
  id: "local",
  meta: {
    title: "Local Pulumi State",
    description: "Stores Pulumi state in the runtime's persistent local state directory.",
  },
  spec: { url: "file://~" },
} satisfies PulumiStateBackendCreateInput

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
