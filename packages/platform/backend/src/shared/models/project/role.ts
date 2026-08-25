import type { PermissionDefinition } from "../permission"
import { instanceIdSchema, z } from "@highstate/contract"

export const projectPermissionRestrictionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("resources"),
    resourceIds: uniqueStrings(z.string().min(1)),
  }),
  z.object({
    type: z.literal("instances"),
    instanceIds: uniqueStrings(instanceIdSchema),
    recursive: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("owners"),
    serviceAccountIds: uniqueStrings(z.cuid2()),
  }),
  z.object({
    type: z.literal("self"),
  }),
  z.object({
    type: z.literal("workers"),
    workerIds: uniqueStrings(z.cuid2()),
  }),
])

export type ProjectPermissionRestriction = z.infer<typeof projectPermissionRestrictionSchema>

const projectPermissionRestrictionsSchema = z
  .array(projectPermissionRestrictionSchema)
  .min(1)
  .refine(
    restrictions =>
      new Set(restrictions.map(restriction => restriction.type)).size === restrictions.length,
    "Restriction types must be unique",
  )

export type ProjectPermissionRestrictionType = ProjectPermissionRestriction["type"]

export type ProjectResourceType =
  | "operation"
  | "secret"
  | "artifact"
  | "terminal"
  | "page"
  | "panel"
  | "worker"
  | "worker-version"
  | "entity"
  | "entity-snapshot"
  | "trigger"
  | "unlock-method"
  | "service-account"
  | "api-key"
  | "role"

export type ProjectPermissionGroupDefinition = {
  title: string
  permissions: readonly PermissionDefinition[]
  supportedRestrictions: readonly ProjectPermissionRestrictionType[]
  resourceType?: ProjectResourceType
}

export const projectPermissionGroups = [
  {
    title: "Instance models",
    permissions: [
      {
        name: "instance-model.get",
        title: "View instance models",
        risk: "low",
      },
      {
        name: "instance-model.update",
        title: "Update instance models",
        risk: "high",
      },
    ],
    supportedRestrictions: ["instances"],
  },
  {
    title: "Instance states",
    permissions: [
      {
        name: "instance-state.get",
        title: "View instance states",
        risk: "low",
      },
      {
        name: "instance-state.list",
        title: "List instance states",
        risk: "low",
      },
      {
        name: "instance-status.update",
        title: "Update instance statuses",
        risk: "medium",
      },
      {
        name: "instance-state.delete",
        title: "Forget instance states",
        risk: "high",
      },
    ],
    supportedRestrictions: ["instances"],
  },
  {
    title: "Operations",
    permissions: [
      {
        name: "operation.get",
        title: "View operations",
        risk: "low",
      },
      {
        name: "operation.list",
        title: "List operations",
        risk: "low",
      },
      {
        name: "operation.create",
        title: "Create operations",
        risk: "high",
      },
      {
        name: "operation.cancel",
        title: "Cancel operations",
        risk: "high",
      },
      {
        name: "operation.logs.get",
        title: "View operation logs",
        risk: "medium",
      },
    ],
    supportedRestrictions: ["resources", "instances"],
    resourceType: "operation",
  },
  {
    title: "Secrets",
    permissions: [
      {
        name: "secret.metadata.get",
        title: "View secret metadata",
        risk: "low",
      },
      {
        name: "secret.value.get",
        title: "View secret values",
        risk: "high",
      },
      {
        name: "secret.list",
        title: "List secrets",
        risk: "low",
      },
      {
        name: "secret.create",
        title: "Create secrets",
        risk: "high",
      },
      {
        name: "secret.update",
        title: "Update secrets",
        risk: "high",
      },
      {
        name: "secret.delete",
        title: "Delete secrets",
        risk: "high",
      },
    ],
    supportedRestrictions: ["resources", "instances", "owners", "self"],
    resourceType: "secret",
  },
  {
    title: "Artifacts",
    permissions: [
      {
        name: "artifact.get",
        title: "View artifacts",
        risk: "low",
      },
      {
        name: "artifact.list",
        title: "List artifacts",
        risk: "low",
      },
      {
        name: "artifact.create",
        title: "Create artifacts",
        risk: "medium",
      },
      {
        name: "artifact.delete",
        title: "Delete artifacts",
        risk: "high",
      },
    ],
    supportedRestrictions: ["resources", "instances", "owners", "self"],
    resourceType: "artifact",
  },
  {
    title: "Terminals",
    permissions: [
      {
        name: "terminal.get",
        title: "View terminals",
        risk: "low",
      },
      {
        name: "terminal.list",
        title: "List terminals",
        risk: "low",
      },
      {
        name: "terminal.connect",
        title: "Connect to terminals",
        risk: "high",
      },
      {
        name: "terminal.create",
        title: "Create terminals",
        risk: "high",
      },
      {
        name: "terminal.update",
        title: "Update terminals",
        risk: "high",
      },
      {
        name: "terminal.delete",
        title: "Delete terminals",
        risk: "high",
      },
    ],
    supportedRestrictions: ["resources", "instances", "owners", "self"],
    resourceType: "terminal",
  },
  {
    title: "Pages",
    permissions: [
      {
        name: "page.get",
        title: "View pages",
        risk: "low",
      },
      {
        name: "page.list",
        title: "List pages",
        risk: "low",
      },
      {
        name: "page.create",
        title: "Create pages",
        risk: "medium",
      },
      {
        name: "page.update",
        title: "Update pages",
        risk: "medium",
      },
      {
        name: "page.delete",
        title: "Delete pages",
        risk: "high",
      },
    ],
    supportedRestrictions: ["resources", "instances", "owners", "self"],
    resourceType: "page",
  },
  {
    title: "Panels",
    permissions: [
      {
        name: "panel.get",
        title: "View panels",
        risk: "low",
      },
      {
        name: "panel.list",
        title: "List panels",
        risk: "low",
      },
      {
        name: "panel.create",
        title: "Create panels",
        risk: "medium",
      },
      {
        name: "panel.update",
        title: "Update panels",
        risk: "medium",
      },
      {
        name: "panel.delete",
        title: "Delete panels",
        risk: "high",
      },
    ],
    supportedRestrictions: ["resources", "instances", "owners", "self", "workers"],
    resourceType: "panel",
  },
  {
    title: "Workers",
    permissions: [
      {
        name: "worker.get",
        title: "View workers",
        risk: "low",
      },
      {
        name: "worker.list",
        title: "List workers",
        risk: "low",
      },
      {
        name: "worker.manage",
        title: "Manage workers",
        risk: "high",
      },
    ],
    supportedRestrictions: ["resources", "owners", "self", "workers"],
    resourceType: "worker",
  },
  {
    title: "Worker versions",
    permissions: [
      {
        name: "worker-version.get",
        title: "View worker versions",
        risk: "low",
      },
      {
        name: "worker-version.list",
        title: "List worker versions",
        risk: "low",
      },
      {
        name: "worker-version.restart",
        title: "Restart worker versions",
        risk: "high",
      },
    ],
    supportedRestrictions: ["resources", "owners", "self", "workers"],
    resourceType: "worker-version",
  },
  {
    title: "Entities",
    permissions: [
      { name: "entity.get", title: "View entities", risk: "low" },
      { name: "entity.list", title: "List entities", risk: "low" },
    ],
    supportedRestrictions: ["resources", "instances", "owners", "self"],
    resourceType: "entity",
  },
  {
    title: "Entity snapshots",
    permissions: [
      { name: "entity-snapshot.get", title: "View entity snapshots", risk: "medium" },
      { name: "entity-snapshot.list", title: "List entity snapshots", risk: "low" },
    ],
    supportedRestrictions: ["resources", "instances", "owners", "self"],
    resourceType: "entity-snapshot",
  },
  {
    title: "Triggers",
    permissions: [
      { name: "trigger.get", title: "View triggers", risk: "low" },
      { name: "trigger.list", title: "List triggers", risk: "low" },
    ],
    supportedRestrictions: ["resources", "instances"],
    resourceType: "trigger",
  },
  {
    title: "Unlock methods",
    permissions: [
      { name: "unlock-method.get", title: "View unlock methods", risk: "low" },
      { name: "unlock-method.list", title: "List unlock methods", risk: "low" },
      {
        name: "unlock-method.create",
        title: "Create unlock methods",
        risk: "critical",
        consequence: "Allows adding identities that can decrypt the project.",
      },
      {
        name: "unlock-method.delete",
        title: "Delete unlock methods",
        risk: "critical",
        consequence: "Allows removing identities that can decrypt the project.",
      },
    ],
    supportedRestrictions: ["resources"],
    resourceType: "unlock-method",
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
        consequence: "Allows acting with the authority of another project service account.",
      },
    ],
    supportedRestrictions: ["resources"],
    resourceType: "service-account",
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
    supportedRestrictions: ["resources", "owners", "self"],
    resourceType: "api-key",
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
    resourceType: "role",
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
] as const satisfies readonly ProjectPermissionGroupDefinition[]

export function getProjectPermissionGroup(
  permission: string,
): ProjectPermissionGroupDefinition | undefined {
  return projectPermissionGroups.find(group =>
    group.permissions.some(candidate => candidate.name === permission),
  )
}

const projectPermissionNames = projectPermissionGroups.flatMap(group =>
  group.permissions.map(permission => permission.name),
)

export const projectPermissionSchema = z.enum(projectPermissionNames)

export type ProjectPermission = z.infer<typeof projectPermissionSchema>

export const projectRoleRuleSchema: z.ZodType<{
  permissions: ProjectPermission[]
  restrictions?: ProjectPermissionRestriction[]
}> = z
  .object({
    permissions: uniqueStrings(projectPermissionSchema),
    restrictions: projectPermissionRestrictionsSchema.optional(),
  })
  .strict()
  .superRefine((rule, context) => {
    const groups = projectPermissionGroups.filter(group =>
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

      if (restriction.type !== "resources") continue

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

export type ProjectRoleRule = z.infer<typeof projectRoleRuleSchema>

export const projectRoleRulesSchema = z.array(projectRoleRuleSchema).min(1)

export type ProjectRoleRules = z.infer<typeof projectRoleRulesSchema>

function uniqueStrings<TSchema extends z.ZodType<string>>(schema: TSchema) {
  return z
    .array(schema)
    .min(1)
    .refine(values => new Set(values).size === values.length, "Values must be unique")
}
