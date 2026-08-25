<script setup lang="ts">
import type {
  ProjectPermissionRestriction,
  ProjectRoleRule,
  ProjectRoleRestrictionOptions,
  ProjectRoleRules,
} from "@highstate/backend/shared"
import { projectPermissionGroups } from "@highstate/backend/shared"
import type { RoleRuleBuilderGroup, RoleRuleBuilderRule } from "../business/role-rules-builder"
import RoleRulesBuilder from "./RoleRulesBuilder.vue"

const {
  options,
  allowedRules,
  allowEmpty = false,
  sectionTitle = "Rules",
} = defineProps<{
  options: ProjectRoleRestrictionOptions
  allowedRules?: ProjectRoleRule[]
  allowEmpty?: boolean
  sectionTitle?: string
}>()
const rules = defineModel<ProjectRoleRules>({ required: true })
const groups = computed<RoleRuleBuilderGroup[]>(() =>
  projectPermissionGroups.flatMap((group, index) => {
    const permissions = group.permissions.filter(
      permission =>
        !allowedRules || allowedRules.some(rule => rule.permissions.includes(permission.name)),
    )
    if (permissions.length === 0) return []
    const unrestricted = permissions.some(permission =>
      allowedRules?.some(rule => rule.permissions.includes(permission.name) && !rule.restrictions),
    )
    const supportedRestrictions = unrestricted
      ? [...group.supportedRestrictions]
      : group.supportedRestrictions.filter(type =>
          allowedRules?.some(
            rule =>
              rule.permissions.some(permission =>
                permissions.some(candidate => candidate.name === permission),
              ) && rule.restrictions?.some(restriction => restriction.type === type),
          ),
        )
    return [
      {
        id: String(index),
        title: group.title,
        permissions: permissions.map(permission => ({ ...permission })),
        supportedRestrictions,
        resourceType: "resourceType" in group ? group.resourceType : undefined,
      },
    ]
  }),
)
const descriptors = [
  { id: "resources", title: "Resources" },
  { id: "instances", title: "Instances", recursive: true },
  { id: "owners", title: "Owners" },
  { id: "self", title: "Self" },
  { id: "workers", title: "Workers" },
]
const allBuilderOptions = computed(() => ({
  ...options.resources,
  instances: options.instances,
  owners: options.serviceAccounts,
  self: [{ id: "self", title: "Current service account" }],
  workers: options.workers,
}))
const builderOptions = computed(() => {
  if (!allowedRules) return allBuilderOptions.value
  return Object.fromEntries(
    Object.entries(allBuilderOptions.value).map(([type, items]) => {
      const resourceGroup = projectPermissionGroups.find(
        group => "resourceType" in group && group.resourceType === type,
      )
      const relevantGroups = resourceGroup
        ? [resourceGroup]
        : projectPermissionGroups.filter(group =>
            group.supportedRestrictions.includes(type as never),
          )
      const relevantPermissions = relevantGroups.flatMap(group =>
        group.permissions.map(permission => permission.name),
      )
      const unrestricted = allowedRules.some(
        rule =>
          rule.permissions.some(permission => relevantPermissions.includes(permission)) &&
          !rule.restrictions,
      )
      if (unrestricted) return [type, items]
      const allowedIds = new Set(
        allowedRules.flatMap(rule =>
          rule.permissions.some(permission => relevantPermissions.includes(permission))
            ? (rule.restrictions ?? [])
                .filter(restriction =>
                  type === "resources"
                    ? restriction.type === "resources"
                    : restriction.type === type,
                )
                .flatMap(idsFor)
            : [],
        ),
      )
      return [type, items.filter(item => allowedIds.has(item.id))]
    }),
  )
})
let skipSync = false
const builderRules = ref<RoleRuleBuilderRule[]>(toBuilder(rules.value))
watch(
  rules,
  value => {
    if (skipSync) {
      skipSync = false
      return
    }
    builderRules.value = toBuilder(value)
  },
  { deep: true },
)

function toBuilder(value: ProjectRoleRules): RoleRuleBuilderRule[] {
  return value.map(rule => ({
    groupId: String(
      projectPermissionGroups.findIndex(group =>
        group.permissions.some(permission => permission.name === rule.permissions[0]),
      ),
    ),
    permissions: [...rule.permissions],
    restrictions: (rule.restrictions ?? []).map(restriction => ({
      type: restriction.type,
      ids: idsFor(restriction),
      recursive: "recursive" in restriction ? restriction.recursive : undefined,
    })),
  }))
}
function idsFor(restriction: ProjectPermissionRestriction): string[] {
  switch (restriction.type) {
    case "resources":
      return restriction.resourceIds
    case "instances":
      return restriction.instanceIds
    case "owners":
      return restriction.serviceAccountIds
    case "workers":
      return restriction.workerIds
    case "self":
      return ["self"]
  }
}
function createRestriction(
  restriction: RoleRuleBuilderRule["restrictions"][number],
): ProjectPermissionRestriction {
  switch (restriction.type) {
    case "resources":
      return { type: "resources", resourceIds: restriction.ids }
    case "instances":
      return {
        type: "instances",
        instanceIds: restriction.ids,
        recursive: restriction.recursive ?? false,
      }
    case "owners":
      return { type: "owners", serviceAccountIds: restriction.ids }
    case "workers":
      return { type: "workers", workerIds: restriction.ids }
    case "self":
      return { type: "self" }
    default:
      throw new Error(`Unsupported project restriction "${restriction.type}"`)
  }
}
function update(value: RoleRuleBuilderRule[]): void {
  builderRules.value = value
  skipSync = true
  rules.value = value.map(rule => ({
    permissions: rule.permissions as ProjectRoleRules[number]["permissions"],
    ...(rule.restrictions.length ? { restrictions: rule.restrictions.map(createRestriction) } : {}),
  }))
}
</script>

<template>
  <RoleRulesBuilder
    :model-value="builderRules"
    :groups="groups"
    :restriction-descriptors="descriptors"
    :options="builderOptions"
    :allow-empty="allowEmpty"
    :section-title="sectionTitle"
    @update:model-value="update"
  />
</template>
