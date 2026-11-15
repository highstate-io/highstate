<script setup lang="ts">
const { projectId } = defineProps<{ projectId: string }>()
const stateStore = await useProjectStateStore.async(projectId)
const { $client } = useNuxtApp()
const loading = ref(false)
const error = ref<string>()

const lockProject = async () => {
  if (loading.value) {
    return
  }

  loading.value = true

  try {
    await $client.state.lockProject.mutate({ projectId })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to lock project"
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <VBtn
    v-if="stateStore.unlockState?.type === 'unlocked'"
    variant="text"
    size="small"
    class="ma-1"
    style="min-width: 0"
    :loading="loading"
    aria-label="Lock project"
    @click="lockProject"
  >
    <VIcon>mdi-lock-open-outline</VIcon>
    <VTooltip activator="parent" location="bottom">Lock project</VTooltip>
  </VBtn>
  <VSnackbar :model-value="!!error" color="error" @update:model-value="error = undefined">
    {{ error }}
  </VSnackbar>
</template>
