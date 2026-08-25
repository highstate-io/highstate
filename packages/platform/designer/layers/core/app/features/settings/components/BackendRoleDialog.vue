<script setup lang="ts">
import type {
  BackendRoleInput,
  BackendRoleOutput,
  BackendRoleRules,
  BackendRoleRestrictionOptions,
} from "@highstate/backend/shared"
import {
  assessPermissionRisk,
  backendPermissionGroups,
  backendRoleRulesSchema,
} from "@highstate/backend/shared"
import { VueMonacoEditor } from "@guolao/vue-monaco-editor"
import { stringify } from "yaml"
import BackendRoleRulesBuilder from "./BackendRoleRulesBuilder.vue"

const { role, loading, restrictionOptions } = defineProps<{
  role?: BackendRoleOutput | null
  loading?: boolean
  restrictionOptions: BackendRoleRestrictionOptions
}>()
const visible = defineModel<boolean>("visible", { required: true })
const emit = defineEmits<{ save: [input: BackendRoleInput] }>()

const title = ref("")
const description = ref("")
const rules = ref<BackendRoleRules>([])
const error = ref<string | null>(null)
const rulesYaml = computed(() => stringify(rules.value))
const valid = computed(() => {
  return title.value.trim().length > 0 && backendRoleRulesSchema.safeParse(rules.value).success
})
const riskColors = {
  low: "success",
  medium: "info",
  high: "warning",
  critical: "error",
} as const
const riskAssessment = computed(() => {
  const permissionDefinitions = new Map(
    backendPermissionGroups.flatMap(group =>
      group.permissions.map(permission => [permission.name, permission] as const),
    ),
  )

  return assessPermissionRisk(
    rules.value.flatMap(rule =>
      rule.permissions.flatMap(permission => {
        const definition = permissionDefinitions.get(permission)
        return definition ? [{ permission: definition, restricted: !!rule.restrictions }] : []
      }),
    ),
  )
})

watch(
  () => [visible.value, role] as const,
  () => {
    if (!visible.value) return

    title.value = role?.meta.title ?? ""
    description.value = role?.meta.description ?? ""
    rules.value = role ? backendRoleRulesSchema.parse(role.rules) : []
    error.value = null
  },
  { immediate: true },
)

function save(): void {
  try {
    const parsedRules = backendRoleRulesSchema.parse(rules.value)
    if (!title.value.trim()) {
      throw new Error("Title is required")
    }

    error.value = null
    emit("save", {
      meta: {
        title: title.value.trim(),
        description: description.value.trim() || undefined,
      },
      rules: parsedRules,
    })
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Invalid role rules"
  }
}
</script>

<template>
  <VDialog v-model="visible" max-width="1200" class="role-dialog">
    <VCard :title="role ? 'Edit backend role' : 'Create backend role'" color="#2d2d2d">
      <VCardText class="role-card-content">
        <VContainer fluid class="pa-0 fill-height">
          <VRow no-gutters class="fill-height">
            <VCol cols="12" md="6" class="pr-md-4 column-container">
              <div class="text-overline mb-2">Metadata</div>
              <VTextField
                v-model="title"
                class="mb-3 flex-grow-0"
                label="Title"
                variant="outlined"
                density="compact"
                :rules="[value => !!value?.trim() || 'Title is required']"
                required
                autofocus
              />
              <VTextarea
                v-model="description"
                class="mb-4 flex-grow-0"
                label="Description"
                variant="outlined"
                density="compact"
                rows="2"
              />
              <VDivider class="mb-4" />
              <div class="builder-scrollable">
                <BackendRoleRulesBuilder v-model="rules" :options="restrictionOptions" />
              </div>
            </VCol>

            <VDivider vertical class="d-none d-md-flex" />

            <VCol cols="12" md="6" class="pl-md-4 column-container">
              <div class="text-overline mb-2">Preview</div>
              <div class="preview-editor">
                <VueMonacoEditor
                  :value="rulesYaml"
                  theme="dark-plus"
                  language="yaml"
                  :options="{
                    readOnly: true,
                    tabSize: 2,
                    minimap: { enabled: false },
                    automaticLayout: true,
                  }"
                />
              </div>
              <VCard variant="flat" class="risk-overview mt-4 pa-4">
                <div class="d-flex align-center justify-space-between mb-2">
                  <div class="text-overline">Risk overview</div>
                  <VChip
                    v-if="riskAssessment.risk"
                    :color="riskColors[riskAssessment.risk]"
                    variant="tonal"
                  >
                    {{ riskAssessment.risk }}
                    risk
                  </VChip>
                  <VChip v-else variant="tonal">No risk</VChip>
                </div>
                <p class="risk-message text-body-2 text-medium-emphasis mb-0">
                  {{ riskAssessment.message }}
                </p>
              </VCard>
              <VAlert v-if="error" type="error" density="compact" class="mt-4">{{ error }}</VAlert>
            </VCol>
          </VRow>
        </VContainer>
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
.role-dialog :deep(.v-overlay__content) {
  height: 80vh;
  max-height: 80vh;
}

.role-dialog :deep(.v-overlay__content > .v-card) {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.role-card-content {
  flex: 1;
  overflow: hidden;
}

.column-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.builder-scrollable {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.preview-editor {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
}

.risk-overview {
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  min-height: 128px;
  max-height: 50%;
  overflow: hidden;
}

.risk-message {
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
}

@media (max-width: 960px) {
  .role-card-content {
    overflow-y: auto;
  }

  .column-container {
    height: auto;
  }

  .builder-scrollable,
  .preview-editor {
    min-height: 300px;
    max-height: 300px;
  }
}
</style>
