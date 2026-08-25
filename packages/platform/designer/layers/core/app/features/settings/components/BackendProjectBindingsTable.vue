<script setup lang="ts">
import type { BackendProjectServiceAccountOption } from "@highstate/backend/shared"

const { serviceAccountId, readonly } = defineProps<{
  serviceAccountId: string
  readonly?: boolean
}>()
const count = defineModel<number>("count", { default: 0 })
const { $client } = useNuxtApp()

const projects = ref<BackendProjectServiceAccountOption[]>([])
const loadingProjectIds = reactive(new Set<string>())
const error = ref<string | null>(null)

async function load(): Promise<void> {
  try {
    projects.value = await $client.backendServiceAccountSettings.getProjectBindingOptions.query({
      serviceAccountId,
    })
    count.value = projects.value.filter(project => project.binding).length
    error.value = null
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Failed to load project bindings"
  }
}

function selectItems(project: BackendProjectServiceAccountOption) {
  if (project.serviceAccounts.length > 0 || !project.binding) {
    return project.serviceAccounts
  }

  return [
    {
      id: project.binding.projectServiceAccountId,
      meta: { title: project.binding.projectServiceAccountId },
      systemName: null,
    },
  ]
}

async function setBinding(
  projectId: string,
  projectServiceAccountId: string | null,
): Promise<void> {
  loadingProjectIds.add(projectId)

  try {
    await $client.backendServiceAccountSettings.setProjectBinding.mutate({
      serviceAccountId,
      projectId,
      projectServiceAccountId,
    })
    await load()
  } finally {
    loadingProjectIds.delete(projectId)
  }
}

await load()
</script>

<template>
  <div class="pa-4">
    <VAlert v-if="error" type="error" density="compact" class="mb-4">{{ error }}</VAlert>
    <VTable>
      <thead>
        <tr>
          <th>Project</th>
          <th>Status</th>
          <th>Project service account</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="project in projects" :key="project.projectId">
          <td>{{ project.projectMeta.title }}</td>
          <td>
            <VChip :color="project.unlocked ? 'success' : 'warning'" size="small">
              {{ project.unlocked ? "Unlocked" : "Locked" }}
            </VChip>
          </td>
          <td>
            <VSelect
              :model-value="project.binding?.projectServiceAccountId ?? null"
              :items="selectItems(project)"
              item-title="meta.title"
              item-value="id"
              density="compact"
              variant="outlined"
              hide-details
              clearable
              :disabled="readonly || !project.unlocked"
              :loading="loadingProjectIds.has(project.projectId)"
              @update:model-value="setBinding(project.projectId, $event)"
            />
          </td>
        </tr>
        <tr v-if="projects.length === 0">
          <td colspan="3" class="text-center text-medium-emphasis py-4">No projects</td>
        </tr>
      </tbody>
    </VTable>
  </div>
</template>
