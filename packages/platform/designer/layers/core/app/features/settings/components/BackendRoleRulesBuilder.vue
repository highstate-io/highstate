<script setup lang="ts">
import type {
  BackendPermissionRestriction,
  BackendRoleRule,
  BackendRoleRules,
  BackendRoleRestrictionOptions,
} from "@highstate/backend/shared"
import { backendPermissionGroups } from "@highstate/backend/shared"
import type { RoleRuleBuilderGroup, RoleRuleBuilderRule } from "../business/role-rules-builder"
import RoleRulesBuilder from "./RoleRulesBuilder.vue"

const {
  options,
  allowedRules,
  allowEmpty = false,
  sectionTitle = "Rules",
} = defineProps<{
  options: BackendRoleRestrictionOptions
  allowedRules?: BackendRoleRule[]
  allowEmpty?: boolean
  sectionTitle?: string
}>()
const rules = defineModel<BackendRoleRules>({ required: true })

const groups = computed<RoleRuleBuilderGroup[]>(() =>
  backendPermissionGroups.flatMap((group, index) => {
    const permissions = group.permissions.filter(
      permission =>
        !allowedRules || allowedRules.some(rule => rule.permissions.includes(permission.name)),
    )
    if (permissions.length === 0) {
      return []
    }

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

const restrictionDescriptors = [
  { id: "resources", title: "Resources" },
  { id: "projects", title: "Projects" },
  { id: "project-spaces", title: "Project spaces", recursive: true },
  { id: "projects-in-spaces", title: "Projects in spaces", recursive: true },
]

const allBuilderOptions = computed(() => ({
  ...Object.fromEntries(
    Object.entries(options.resources).map(([type, items]) => [
      type,
      items.map(item => ({ id: item.id, title: item.meta.title })),
    ]),
  ),
  projects: options.projects.map(item => ({ id: item.id, title: item.meta.title })),
  "project-spaces": options.projectSpaces.map(item => ({ id: item.id, title: item.meta.title })),
  "projects-in-spaces": options.projectSpaces.map(item => ({
    id: item.id,
    title: item.meta.title,
  })),
}))

const builderOptions = computed(() => {
  if (!allowedRules) {
    return allBuilderOptions.value
  }

  return Object.fromEntries(
    Object.entries(allBuilderOptions.value).map(([type, items]) => {
      const relevantGroups = backendPermissionGroups.filter(group =>
        type === "resources" ? false : group.supportedRestrictions.includes(type as never),
      )
      const resourceGroup = backendPermissionGroups.find(
        group => "resourceType" in group && group.resourceType === type,
      )
      const relevantPermissions = (resourceGroup ? [resourceGroup] : relevantGroups).flatMap(
        group => group.permissions.map(permission => permission.name),
      )
      const unrestricted = allowedRules.some(
        rule =>
          rule.permissions.some(permission => relevantPermissions.includes(permission)) &&
          !rule.restrictions,
      )
      if (unrestricted) {
        return [type, items]
      }

      const allowedIds = new Set(
        allowedRules.flatMap(rule =>
          rule.permissions.some(permission => relevantPermissions.includes(permission))
            ? (rule.restrictions ?? [])
                .filter(restriction =>
                  type === "resources"
                    ? restriction.type === "resources"
                    : restriction.type === type,
                )
                .flatMap(getRestrictionIds)
            : [],
        ),
      )
      return [type, items.filter(item => allowedIds.has(item.id))]
    }),
  )
})

let skipNextRulesSync = false

const builderRules = ref<RoleRuleBuilderRule[]>(toBuilderRules(rules.value))

watch(
  rules,
  value => {
    if (skipNextRulesSync) {
      skipNextRulesSync = false
      return
    }

    builderRules.value = toBuilderRules(value)
  },
  { deep: true },
)

function toBuilderRules(value: BackendRoleRules): RoleRuleBuilderRule[] {
  return value.map(rule => ({
    groupId: String(
      backendPermissionGroups.findIndex(group =>
        group.permissions.some(permission => permission.name === rule.permissions[0]),
      ),
    ),
    permissions: [...rule.permissions],
    restrictions: (rule.restrictions ?? []).map(restriction => ({
      type: restriction.type,
      ids: getRestrictionIds(restriction),
      recursive: "recursive" in restriction ? restriction.recursive : undefined,
    })),
  }))
}

function updateBuilderRules(value: RoleRuleBuilderRule[]): void {
  builderRules.value = value
  skipNextRulesSync = true
  rules.value = value.map(rule => ({
    permissions: rule.permissions as BackendRoleRules[number]["permissions"],
    ...(rule.restrictions.length > 0
      ? { restrictions: rule.restrictions.map(restriction => createRestriction(restriction)) }
      : {}),
  }))
}

function getRestrictionIds(restriction: BackendPermissionRestriction): string[] {
  switch (restriction.type) {
    case "resources":
      return restriction.resourceIds
    case "projects":
      return restriction.projectIds
    case "project-spaces":
    case "projects-in-spaces":
      return restriction.projectSpaceIds
  }
}

function createRestriction(
  restriction: RoleRuleBuilderRule["restrictions"][number],
): BackendPermissionRestriction {
  switch (restriction.type) {
    case "resources":
      return { type: "resources", resourceIds: restriction.ids }
    case "projects":
      return { type: "projects", projectIds: restriction.ids }
    case "project-spaces":
      return {
        type: "project-spaces",
        projectSpaceIds: restriction.ids,
        recursive: restriction.recursive ?? false,
      }
    case "projects-in-spaces":
      return {
        type: "projects-in-spaces",
        projectSpaceIds: restriction.ids,
        recursive: restriction.recursive ?? false,
      }
    default:
      throw new Error(`Unsupported backend restriction "${restriction.type}"`)
  }
}
</script>

<template>
  <RoleRulesBuilder
    :model-value="builderRules"
    :groups="groups"
    :restriction-descriptors="restrictionDescriptors"
    :options="builderOptions"
    :allow-empty="allowEmpty"
    :section-title="sectionTitle"
    @update:model-value="updateBuilderRules"
  />
</template>
