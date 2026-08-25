<script setup lang="ts">
import type {
  ProjectRoleInput,
  ProjectRoleOutput,
  ProjectRoleRestrictionOptions,
  ProjectRoleRules,
} from "@highstate/backend/shared"
import {
  assessPermissionRisk,
  projectPermissionGroups,
  projectRoleRulesSchema,
} from "@highstate/backend/shared"
import { VueMonacoEditor } from "@guolao/vue-monaco-editor"
import { stringify } from "yaml"
import ProjectRoleRulesBuilder from "./ProjectRoleRulesBuilder.vue"

const { role, loading } = defineProps<{
  role?: ProjectRoleOutput | null
  loading?: boolean
  restrictionOptions: ProjectRoleRestrictionOptions
}>()
const visible = defineModel<boolean>("visible", { required: true })
const emit = defineEmits<{ save: [input: ProjectRoleInput] }>()
const title = ref("")
const description = ref("")
const rules = ref<ProjectRoleRules>([])
const error = ref<string | null>(null)
const rulesYaml = computed(() => stringify(rules.value))
const riskColors = { low: "success", medium: "info", high: "warning", critical: "error" } as const
const riskAssessment = computed(() => {
  const definitions = new Map(
    projectPermissionGroups.flatMap(group =>
      group.permissions.map(permission => [permission.name, permission] as const),
    ),
  )
  return assessPermissionRisk(
    rules.value.flatMap(rule =>
      rule.permissions.flatMap(permission => {
        const definition = definitions.get(permission)
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
    try {
      rules.value = role ? projectRoleRulesSchema.parse(role.rules) : []
      error.value = null
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "Invalid role rules"
    }
  },
  { immediate: true },
)
const valid = computed(
  () => !!title.value.trim() && projectRoleRulesSchema.safeParse(rules.value).success,
)
function save(): void {
  try {
    const parsedRules = projectRoleRulesSchema.parse(rules.value)
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
  <VDialog v-model="visible" max-width="1200" class="project-role-dialog">
    <VCard :title="role ? 'Edit project role' : 'Create project role'">
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
            <div class="builder">
              <ProjectRoleRulesBuilder v-model="rules" :options="restrictionOptions" />
            </div>
          </VCol>
          <VDivider vertical class="d-none d-md-flex" />
          <VCol cols="12" md="6" class="pl-md-4 column">
            <div class="text-overline mb-2">Preview</div>
            <div class="preview">
              <VueMonacoEditor
                :value="rulesYaml"
                theme="dark-plus"
                language="yaml"
                :options="{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }"
              />
            </div>
            <VCard variant="flat" class="risk mt-4 pa-4">
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
              <p class="text-body-2 text-medium-emphasis mb-0">{{ riskAssessment.message }}</p>
            </VCard>
            <VAlert v-if="error" type="error" density="compact" class="mt-4">{{ error }}</VAlert>
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
.project-role-dialog :deep(.v-overlay__content) {
  height: 80vh;
  max-height: 80vh;
}
.project-role-dialog :deep(.v-overlay__content > .v-card) {
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
.risk {
  flex: 0 1 auto;
  min-height: 128px;
  max-height: 50%;
  overflow-y: auto;
}
</style>
