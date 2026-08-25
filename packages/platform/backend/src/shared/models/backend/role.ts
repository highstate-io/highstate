import type { PermissionDefinition } from "../permission"
import { z } from "@highstate/contract"

export const backendPermissionRestrictionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("resources"),
    resourceIds: uniqueStrings(z.string().min(1)),
  }),
  z.object({
    type: z.literal("projects"),
    projectIds: uniqueStrings(z.cuid2()),
  }),
  z.object({
    type: z.literal("project-spaces"),
    projectSpaceIds: uniqueStrings(z.cuid2()),
    recursive: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("projects-in-spaces"),
    projectSpaceIds: uniqueStrings(z.cuid2()),
    recursive: z.boolean().default(false),
  }),
])

export type BackendPermissionRestriction = z.infer<typeof backendPermissionRestrictionSchema>

const backendPermissionRestrictionsSchema = z
  .array(backendPermissionRestrictionSchema)
  .min(1)
  .refine(
    restrictions =>
      new Set(restrictions.map(restriction => restriction.type)).size === restrictions.length,
    "Restriction types must be unique",
  )

export type BackendPermissionRestrictionType = BackendPermissionRestriction["type"]

export type BackendResourceType =
  | "library"
  | "pulumi-backend"
  | "project-model-storage"
  | "backend-service-account"
  | "backend-api-key"
  | "backend-role"

export type BackendPermissionGroupDefinition = {
  title: string
  permissions: readonly PermissionDefinition[]
  supportedRestrictions: readonly BackendPermissionRestrictionType[]
  resourceType?: BackendResourceType
}

export const backendPermissionGroups = [
  {
    title: "Backend",
    permissions: [
      {
        name: "backend.get",
        title: "View backend",
        risk: "low",
      },
      {
        name: "backend.update",
        title: "Update backend",
        risk: "critical",
        consequence: "Allows changing backend-wide configuration and security-sensitive settings.",
      },
      {
        name: "backend.search",
        title: "Search backend",
        risk: "low",
      },
    ],
    supportedRestrictions: [],
  },
  {
    title: "Projects",
    permissions: [
      {
        name: "project.get",
        title: "View projects",
        risk: "low",
      },
      {
        name: "project.list",
        title: "List projects",
        risk: "low",
      },
      {
        name: "project.create",
        title: "Create projects",
        risk: "high",
      },
      {
        name: "project.open",
        title: "Open projects",
        risk: "high",
      },
      {
        name: "project.unlock",
        title: "Unlock projects",
        risk: "critical",
        consequence: "Allows submitting an identity that decrypts and opens a project.",
      },
      {
        name: "project.attach",
        title: "Attach projects",
        risk: "high",
      },
      {
        name: "project.detach",
        title: "Detach projects",
        risk: "critical",
        consequence:
          "Allows disconnecting projects and making their resources unavailable through the backend.",
      },
      {
        name: "project.migrate",
        title: "Migrate projects",
        risk: "critical",
        consequence:
          "Allows moving project data between storage backends and changing where it is controlled.",
      },
    ],
    supportedRestrictions: ["projects", "projects-in-spaces"],
  },
  {
    title: "Backend service account project bindings",
    permissions: [
      {
        name: "backend-service-account-project-binding.get",
        title: "View backend service account project bindings",
        risk: "low",
      },
      {
        name: "backend-service-account-project-binding.list",
        title: "List backend service account project bindings",
        risk: "low",
      },
      {
        name: "backend-service-account-project-binding.create",
        title: "Create backend service account project bindings",
        risk: "high",
      },
      {
        name: "backend-service-account-project-binding.update",
        title: "Update backend service account project bindings",
        risk: "high",
      },
      {
        name: "backend-service-account-project-binding.delete",
        title: "Delete backend service account project bindings",
        risk: "high",
      },
      {
        name: "backend-service-account-project-binding.bind",
        title: "Bind project service accounts",
        risk: "critical",
        consequence:
          "Allows assigning backend identities to project service accounts and their project permissions.",
      },
    ],
    supportedRestrictions: ["projects", "projects-in-spaces"],
  },
  {
    title: "Project spaces",
    permissions: [
      {
        name: "project-space.get",
        title: "View project spaces",
        risk: "low",
      },
      {
        name: "project-space.list",
        title: "List project spaces",
        risk: "low",
      },
      {
        name: "project-space.create",
        title: "Create project spaces",
        risk: "high",
      },
      {
        name: "project-space.update",
        title: "Update project spaces",
        risk: "high",
      },
      {
        name: "project-space.delete",
        title: "Delete project spaces",
        risk: "critical",
        consequence:
          "Allows deleting project-space organization and affecting every project arranged within it.",
      },
    ],
    supportedRestrictions: ["project-spaces"],
  },
  {
    title: "Libraries",
    permissions: [
      {
        name: "library.get",
        title: "View libraries",
        risk: "low",
      },
      {
        name: "library.list",
        title: "List libraries",
        risk: "low",
      },
      {
        name: "library.manage",
        title: "Manage libraries",
        risk: "high",
      },
    ],
    supportedRestrictions: ["resources"],
    resourceType: "library",
  },
  {
    title: "Pulumi backends",
    permissions: [
      {
        name: "pulumi-backend.get",
        title: "View Pulumi backends",
        risk: "low",
      },
      {
        name: "pulumi-backend.list",
        title: "List Pulumi backends",
        risk: "low",
      },
      {
        name: "pulumi-backend.manage",
        title: "Manage Pulumi backends",
        risk: "critical",
        consequence:
          "Allows changing infrastructure state backends that control deployed resources.",
      },
    ],
    supportedRestrictions: ["resources"],
    resourceType: "pulumi-backend",
  },
  {
    title: "Project model storages",
    permissions: [
      {
        name: "project-model-storage.get",
        title: "View project model storages",
        risk: "low",
      },
      {
        name: "project-model-storage.list",
        title: "List project model storages",
        risk: "low",
      },
      {
        name: "project-model-storage.manage",
        title: "Manage project model storages",
        risk: "critical",
        consequence:
          "Allows changing storage that contains project models and their infrastructure definitions.",
      },
    ],
    supportedRestrictions: ["resources"],
    resourceType: "project-model-storage",
  },
  {
    title: "Service accounts",
    permissions: [
      {
        name: "service-account.get",
        title: "View service accounts",
        risk: "low",
      },
      {
        name: "service-account.list",
        title: "List service accounts",
        risk: "low",
      },
      {
        name: "service-account.manage",
        title: "Manage service accounts",
        risk: "high",
      },
      {
        name: "service-account.impersonate",
        title: "Impersonate service accounts",
        risk: "critical",
        consequence: "Allows acting with the authority of another backend service account.",
      },
    ],
    supportedRestrictions: ["resources"],
    resourceType: "backend-service-account",
  },
  {
    title: "API keys",
    permissions: [
      {
        name: "api-key.get",
        title: "View API keys",
        risk: "low",
      },
      {
        name: "api-key.list",
        title: "List API keys",
        risk: "low",
      },
      {
        name: "api-key.create",
        title: "Create API keys",
        risk: "high",
      },
      {
        name: "api-key.update",
        title: "Update API keys",
        risk: "high",
      },
      {
        name: "api-key.rotate",
        title: "Rotate API keys",
        risk: "high",
      },
      {
        name: "api-key.delete",
        title: "Delete API keys",
        risk: "high",
      },
      {
        name: "api-key.escalate",
        title: "Escalate API key permissions",
        risk: "critical",
        consequence: "Allows API keys to receive permissions beyond the caller's current access.",
      },
    ],
    supportedRestrictions: ["resources"],
    resourceType: "backend-api-key",
  },
  {
    title: "Roles",
    permissions: [
      {
        name: "role.get",
        title: "View roles",
        risk: "low",
      },
      {
        name: "role.list",
        title: "List roles",
        risk: "low",
      },
      {
        name: "role.create",
        title: "Create roles",
        risk: "high",
      },
      {
        name: "role.update",
        title: "Update roles",
        risk: "high",
      },
      {
        name: "role.delete",
        title: "Delete roles",
        risk: "high",
      },
      {
        name: "role.escalate",
        title: "Escalate role permissions",
        risk: "critical",
        consequence: "Allows roles to receive permissions beyond the caller's current access.",
      },
    ],
    supportedRestrictions: ["resources"],
    resourceType: "backend-role",
  },
  {
    title: "Role bindings",
    permissions: [
      {
        name: "role-binding.get",
        title: "View role bindings",
        risk: "low",
      },
      {
        name: "role-binding.list",
        title: "List role bindings",
        risk: "low",
      },
      {
        name: "role-binding.create",
        title: "Create role bindings",
        risk: "high",
      },
      {
        name: "role-binding.delete",
        title: "Delete role bindings",
        risk: "high",
      },
      {
        name: "role-binding.bind",
        title: "Bind roles beyond own permissions",
        risk: "critical",
        consequence: "Allows granting roles whose permissions exceed the caller's current access.",
      },
    ],
    supportedRestrictions: [],
  },
] as const satisfies readonly BackendPermissionGroupDefinition[]

export function getBackendPermissionGroup(
  permission: string,
): BackendPermissionGroupDefinition | undefined {
  return backendPermissionGroups.find(group =>
    group.permissions.some(candidate => candidate.name === permission),
  )
}

const backendPermissionNames = backendPermissionGroups.flatMap(group =>
  group.permissions.map(permission => permission.name),
)

export const backendPermissionSchema = z.enum(backendPermissionNames)

export type BackendPermission = z.infer<typeof backendPermissionSchema>

export const backendRoleRuleSchema: z.ZodType<{
  permissions: BackendPermission[]
  restrictions?: BackendPermissionRestriction[]
}> = z
  .object({
    permissions: uniqueStrings(backendPermissionSchema),
    restrictions: backendPermissionRestrictionsSchema.optional(),
  })
  .strict()
  .superRefine((rule, context) => {
    const groups = backendPermissionGroups.filter(group =>
      group.permissions.some(permission =>
        (rule.permissions as readonly string[]).includes(permission.name),
      ),
    )

    for (const restriction of rule.restrictions ?? []) {
      const incompatibleGroup = groups.find(
        group => !(group.supportedRestrictions as readonly string[]).includes(restriction.type),
      )
      if (incompatibleGroup) {
        context.addIssue({
          code: "custom",
          message: `Permission group "${incompatibleGroup.title}" does not support "${restriction.type}" restriction`,
          path: ["restrictions"],
        })
      }

      if (restriction.type !== "resources") {
        continue
      }

      const resourceTypes = new Set(
        groups.map(group => ("resourceType" in group ? group.resourceType : undefined)),
      )
      if (resourceTypes.size > 1) {
        context.addIssue({
          code: "custom",
          message: "Permissions with resource restrictions must use the same resource type",
          path: ["restrictions"],
        })
      }
    }
  })

export type BackendRoleRule = z.infer<typeof backendRoleRuleSchema>

export const backendRoleRulesSchema = z.array(backendRoleRuleSchema).min(1)

export type BackendRoleRules = z.infer<typeof backendRoleRulesSchema>

function uniqueStrings<TSchema extends z.ZodType<string>>(schema: TSchema) {
  return z
    .array(schema)
    .min(1)
    .refine(values => new Set(values).size === values.length, "Values must be unique")
}
