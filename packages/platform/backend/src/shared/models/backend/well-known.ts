import type {
  LibraryCreateInput,
  ProjectModelStorageCreateInput,
  ProjectSpaceCreateInput,
  PulumiBackendCreateInput,
} from "../../../database/_generated/backend/postgresql/models"

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
