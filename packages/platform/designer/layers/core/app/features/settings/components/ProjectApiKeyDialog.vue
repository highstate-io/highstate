<script setup lang="ts">
import type {
  ApiKeyInput,
  ApiKeyOutput,
  ApiKeyServiceAccountOption,
  ProjectPermissionRestriction,
  ProjectRoleRestrictionOptions,
  ProjectRoleRule,
  ProjectRoleRules,
} from "@highstate/backend/shared"
import { projectRoleRulesSchema } from "@highstate/backend/shared"
import { VueMonacoEditor } from "@guolao/vue-monaco-editor"
import { stringify } from "yaml"
import ProjectRoleRulesBuilder from "./ProjectRoleRulesBuilder.vue"

const { apiKey, serviceAccounts, restrictionOptions, loading } = defineProps<{
  apiKey?: ApiKeyOutput | null
  serviceAccounts: ApiKeyServiceAccountOption[]
  restrictionOptions: ProjectRoleRestrictionOptions
  loading?: boolean
}>()
const visible = defineModel<boolean>("visible", { required: true })
const emit = defineEmits<{ save: [input: ApiKeyInput] }>()
const title = ref("")
const description = ref("")
const serviceAccountId = ref<string>()
const expiresAt = ref("")
const restrictionRules = ref<ProjectRoleRules>([])
const rulesYaml = computed(() => stringify(restrictionRules.value))
const allowedRules = computed(
  () => serviceAccounts.find(item => item.id === serviceAccountId.value)?.rules ?? [],
)
const titleValid = computed(() => !!title.value.trim())
const serviceAccountValid = computed(() =>
  serviceAccounts.some(item => item.id === serviceAccountId.value),
)
const expirationValid = computed(
  () => !expiresAt.value || !Number.isNaN(new Date(expiresAt.value).getTime()),
)
const restrictionSchemaValid = computed(
  () =>
    restrictionRules.value.length === 0 ||
    projectRoleRulesSchema.safeParse(restrictionRules.value).success,
)
const restrictionScopeValid = computed(
  () =>
    restrictionRules.value.length === 0 ||
    restrictionRules.value.every(rule =>
      rule.permissions.every(permission =>
        allowedRules.value.some(
          allowedRule =>
            allowedRule.permissions.includes(permission) && restrictionsCover(allowedRule, rule),
        ),
      ),
    ),
)
const valid = computed(
  () =>
    titleValid.value &&
    serviceAccountValid.value &&
    expirationValid.value &&
    restrictionSchemaValid.value &&
    restrictionScopeValid.value,
)

watch(
  () => [visible.value, apiKey, serviceAccounts] as const,
  () => {
    if (!visible.value) return
    title.value = apiKey?.meta.title ?? ""
    description.value = apiKey?.meta.description ?? ""
    serviceAccountId.value =
      apiKey?.serviceAccountId ?? serviceAccounts.find(item => item.systemName === "admin")?.id
    expiresAt.value = apiKey?.expiresAt ? toLocalDateTime(apiKey.expiresAt) : ""
    restrictionRules.value = apiKey?.restrictionRules ?? []
  },
  { immediate: true },
)

function toLocalDateTime(value: Date): string {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function save(): void {
  if (!valid.value || !serviceAccountId.value) return
  emit("save", {
    meta: { title: title.value.trim(), description: description.value.trim() || undefined },
    serviceAccountId: serviceAccountId.value,
    restrictionRules: restrictionRules.value,
    expiresAt: expiresAt.value ? new Date(expiresAt.value) : null,
  })
}

function changeServiceAccount(value: string): void {
  serviceAccountId.value = value
  restrictionRules.value = []
}

function restrictionsCover(allowedRule: ProjectRoleRule, rule: ProjectRoleRule): boolean {
  if (!allowedRule.restrictions) return true
  if (!rule.restrictions) return false
  return allowedRule.restrictions.every(allowedRestriction => {
    const restriction = rule.restrictions?.find(item => item.type === allowedRestriction.type)
    if (!restriction) return false
    if (allowedRestriction.type === "self") return true
    if (restriction.type === "self") return false
    const allowedIds = restrictionIds(allowedRestriction)
    const ids = restrictionIds(restriction)
    return (
      ids.every(id => allowedIds.includes(id)) &&
      (!("recursive" in restriction) ||
        !restriction.recursive ||
        ("recursive" in allowedRestriction && allowedRestriction.recursive))
    )
  })
}

function restrictionIds(
  restriction: Exclude<ProjectPermissionRestriction, { type: "self" }>,
): string[] {
  switch (restriction.type) {
    case "resources":
      return restriction.resourceIds
    case "instances":
      return restriction.instanceIds
    case "owners":
      return restriction.serviceAccountIds
    case "workers":
      return restriction.workerIds
  }
}
</script>

<template>
  <VDialog v-model="visible" max-width="1200" class="api-key-dialog">
    <VCard :title="apiKey ? 'Edit project API key' : 'Create project API key'">
      <VCardText class="content">
        <VRow no-gutters class="fill-height">
          <VCol cols="12" md="6" class="pr-md-4 column">
            <div class="text-overline mb-2">Metadata</div>
            <VTextField
              v-model="title"
              class="flex-grow-0"
              label="Title"
              variant="outlined"
              density="compact"
              :rules="[value => !!value?.trim() || 'Title is required']"
              required
            />
            <VTextarea
              v-model="description"
              class="flex-grow-0"
              label="Description"
              variant="outlined"
              density="compact"
              rows="2"
            />
            <VSelect
              :model-value="serviceAccountId"
              class="flex-grow-0"
              :items="serviceAccounts"
              item-title="meta.title"
              item-value="id"
              label="Service account"
              variant="outlined"
              density="compact"
              :rules="[value => serviceAccounts.some(item => item.id === value) || 'Service account is required']"
              required
              @update:model-value="changeServiceAccount"
            />
            <VTextField
              v-model="expiresAt"
              class="expires-at-field flex-grow-0"
              type="datetime-local"
              label="Expires at"
              variant="outlined"
              density="compact"
              clearable
              :rules="[value => !value || !Number.isNaN(new Date(value).getTime()) || 'Expiration must be a valid date and time']"
            />
            <div class="builder">
              <ProjectRoleRulesBuilder
                v-model="restrictionRules"
                :options="restrictionOptions"
                :allowed-rules="allowedRules"
                section-title="Restriction Rules"
                allow-empty
              />
            </div>
            <VAlert
              v-if="restrictionRules.length > 0 && restrictionSchemaValid && !restrictionScopeValid"
              type="error"
              variant="outlined"
              density="compact"
              class="flex-grow-0 mt-2"
            >
              Restriction rules exceed the selected service account permissions.
            </VAlert>
          </VCol>
          <VDivider vertical class="d-none d-md-flex" />
          <VCol cols="12" md="6" class="pl-md-4 column">
            <div class="text-overline mb-2">Restriction preview</div>
            <div class="preview">
              <VueMonacoEditor
                :value="rulesYaml"
                theme="dark-plus"
                language="yaml"
                :options="{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }"
              />
            </div>
          </VCol>
        </VRow>
      </VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn :disabled="loading" @click="visible = false">Cancel</VBtn>
        <VBtn color="primary" :disabled="!valid" :loading="loading" @click="save">Save</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>

<style scoped>
.api-key-dialog :deep(.v-overlay__content) {
  height: 80vh;
  max-height: 80vh;
}
.api-key-dialog :deep(.v-overlay__content > .v-card) {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.content {
  flex: 1;
  overflow: hidden;
}
.column {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.builder,
.preview {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.preview {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
}
.expires-at-field :deep(.v-field__field) {
  position: relative;
}
.expires-at-field :deep(input::-webkit-calendar-picker-indicator) {
  position: absolute;
  right: 4px;
}
@media (max-width: 960px) {
  .content {
    overflow-y: auto;
  }
  .column {
    height: auto;
  }
  .builder,
  .preview {
    min-height: 300px;
    max-height: 300px;
  }
}
</style>
