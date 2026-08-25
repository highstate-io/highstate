<script setup lang="ts">
import type {
  RoleRuleBuilderGroup,
  RoleRuleBuilderOption,
  RoleRuleBuilderRule,
  RoleRuleBuilderRestrictionDescriptor,
} from "../business/role-rules-builder"

const {
  groups,
  restrictionDescriptors,
  options,
  allowEmpty = false,
  sectionTitle = "Rules",
} = defineProps<{
  groups: RoleRuleBuilderGroup[]
  restrictionDescriptors: RoleRuleBuilderRestrictionDescriptor[]
  options: Record<string, RoleRuleBuilderOption[]>
  allowEmpty?: boolean
  sectionTitle?: string
}>()

const rules = defineModel<RoleRuleBuilderRule[]>({ required: true })

const riskColors = {
  low: "success",
  medium: "info",
  high: "warning",
  critical: "error",
} as const

function groupFor(rule: RoleRuleBuilderRule): RoleRuleBuilderGroup | undefined {
  return groups.find(group => group.id === rule.groupId)
}

function descriptorFor(type: string): RoleRuleBuilderRestrictionDescriptor | undefined {
  return restrictionDescriptors.find(descriptor => descriptor.id === type)
}

function optionsFor(rule: RoleRuleBuilderRule, type: string): RoleRuleBuilderOption[] {
  return options[type === "resources" ? (groupFor(rule)?.resourceType ?? "") : type] ?? []
}

function permissionsValid(
  rule: RoleRuleBuilderRule,
  permissions: string[] | null,
): boolean | string {
  const availablePermissions = groupFor(rule)?.permissions.map(permission => permission.name) ?? []

  return (
    (!!permissions?.length &&
      permissions.every(permission => availablePermissions.includes(permission))) ||
    "Select at least one allowed permission"
  )
}

function restrictionTypesValid(
  rule: RoleRuleBuilderRule,
  types: string[] | null,
): boolean | string {
  const supportedRestrictions = groupFor(rule)?.supportedRestrictions ?? []

  return (
    (types?.every(type => supportedRestrictions.includes(type)) ?? false) ||
    "Remove restrictions not allowed by the service account"
  )
}

function restrictionIdsValid(
  rule: RoleRuleBuilderRule,
  type: string,
  ids: string[] | null,
): boolean | string {
  const availableIds = optionsFor(rule, type).map(option => option.id)

  return (
    (!!ids?.length && ids.every(id => availableIds.includes(id))) ||
    "Select at least one allowed value"
  )
}

function addRule(): void {
  const group = groups[0]
  if (!group) {
    return
  }

  rules.value = [
    ...rules.value,
    {
      groupId: group.id,
      permissions: [],
      restrictions: [],
    },
  ]
}

function removeRule(index: number): void {
  rules.value = rules.value.filter((_, ruleIndex) => ruleIndex !== index)
}

function changeGroup(rule: RoleRuleBuilderRule, groupId: string): void {
  updateRule(rule, {
    groupId,
    permissions: [],
    restrictions: [],
  })
}

function selectedRestrictionTypes(rule: RoleRuleBuilderRule): string[] {
  return rule.restrictions.map(restriction => restriction.type)
}

function changeRestrictionTypes(rule: RoleRuleBuilderRule, types: string[]): void {
  const existing = new Map(rule.restrictions.map(restriction => [restriction.type, restriction]))
  updateRule(rule, {
    restrictions: types.map(type => existing.get(type) ?? { type, ids: [] }),
  })
}

function updateRule(rule: RoleRuleBuilderRule, patch: Partial<RoleRuleBuilderRule>): void {
  rules.value = rules.value.map(candidate =>
    candidate === rule ? { ...candidate, ...patch } : candidate,
  )
}

function updatePermissions(rule: RoleRuleBuilderRule, permissions: string[]): void {
  updateRule(rule, { permissions })
}

function updateRestrictionIds(rule: RoleRuleBuilderRule, type: string, ids: string[]): void {
  updateRule(rule, {
    restrictions: rule.restrictions.map(restriction =>
      restriction.type === type ? { ...restriction, ids } : restriction,
    ),
  })
}

function updateRestrictionRecursive(
  rule: RoleRuleBuilderRule,
  type: string,
  recursive: boolean | null,
): void {
  updateRule(rule, {
    restrictions: rule.restrictions.map(restriction =>
      restriction.type === type ? { ...restriction, recursive: recursive ?? false } : restriction,
    ),
  })
}
</script>

<template>
  <div class="rules-builder">
    <div class="d-flex align-center justify-space-between mb-4">
      <div>
        <div class="text-overline">{{ sectionTitle }}</div>
      </div>
      <VBtn prepend-icon="mdi-plus" variant="outlined" size="small" @click="addRule">Add rule</VBtn>
    </div>

    <div class="rules-list">
      <VCard v-for="(rule, index) in rules" :key="index" variant="outlined" class="rule-card mb-4">
        <VCardTitle class="d-flex align-center py-3">
          <span class="text-subtitle-1">Rule {{ index + 1 }}</span>
          <VSpacer />
          <VBtn
            icon="mdi-delete-outline"
            color="error"
            variant="text"
            size="small"
            @click="removeRule(index)"
          />
        </VCardTitle>
        <VDivider />
        <VCardText class="pt-4">
          <VSelect
            :model-value="rule.groupId"
            :items="groups"
            item-title="title"
            item-value="id"
            label="Permission group"
            variant="outlined"
            density="compact"
            class="mb-4"
            :rules="[value => groups.some(group => group.id === value) || 'Select an allowed permission group']"
            @update:model-value="changeGroup(rule, $event)"
          />

          <VSelect
            v-if="groupFor(rule)"
            :model-value="rule.permissions"
            :items="groupFor(rule)!.permissions"
            item-title="title"
            item-value="name"
            label="Permissions"
            variant="outlined"
            density="compact"
            multiple
            chips
            closable-chips
            class="mb-4"
            :rules="[value => permissionsValid(rule, value)]"
            @update:model-value="updatePermissions(rule, $event)"
          >
            <template #item="{ props: itemProps, item }">
              <VListItem v-bind="itemProps">
                <template #append>
                  <VChip :color="riskColors[item.raw.risk]" size="x-small">
                    {{ item.raw.risk }}
                  </VChip>
                </template>
              </VListItem>
            </template>
          </VSelect>

          <template v-if="groupFor(rule)?.supportedRestrictions.length">
            <VSelect
              :model-value="selectedRestrictionTypes(rule)"
              :items="
                restrictionDescriptors.filter(descriptor =>
                  groupFor(rule)!.supportedRestrictions.includes(descriptor.id),
                )
              "
              item-title="title"
              item-value="id"
              label="Restrictions"
              variant="outlined"
              density="compact"
              multiple
              chips
              closable-chips
              class="mb-4"
              :rules="[value => restrictionTypesValid(rule, value)]"
              @update:model-value="changeRestrictionTypes(rule, $event)"
            />

            <div
              v-for="restriction in rule.restrictions"
              :key="restriction.type"
              class="restriction mb-4"
            >
              <VSelect
                :model-value="restriction.ids"
                :items="optionsFor(rule, restriction.type)"
                item-title="title"
                item-value="id"
                :label="descriptorFor(restriction.type)?.title"
                variant="outlined"
                density="compact"
                multiple
                chips
                closable-chips
                hide-selected
                :no-data-text="'No matching resources'"
                :rules="[value => restrictionIdsValid(rule, restriction.type, value)]"
                @update:model-value="updateRestrictionIds(rule, restriction.type, $event)"
              />
              <VCheckbox
                v-if="descriptorFor(restriction.type)?.recursive"
                :model-value="restriction.recursive"
                label="Include descendants"
                density="compact"
                hide-details
                class="mt-1"
                @update:model-value="updateRestrictionRecursive(rule, restriction.type, $event)"
              />
            </div>
          </template>
        </VCardText>
      </VCard>

      <VAlert
        v-if="rules.length === 0 && !allowEmpty"
        type="error"
        variant="outlined"
        density="compact"
      >
        At least one rule is required.
      </VAlert>
    </div>
  </div>
</template>

<style scoped>
.rules-builder {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.rules-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.rule-card {
  background: rgb(var(--v-theme-surface));
}

.restriction:last-child {
  margin-bottom: 0 !important;
}
</style>
