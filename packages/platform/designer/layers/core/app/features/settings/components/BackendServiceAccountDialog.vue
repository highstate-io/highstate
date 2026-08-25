<script setup lang="ts">
import type {
  BackendServiceAccountInput,
  BackendServiceAccountOutput,
} from "@highstate/backend/shared"

const { serviceAccount, loading } = defineProps<{
  serviceAccount?: BackendServiceAccountOutput | null
  loading?: boolean
}>()
const visible = defineModel<boolean>("visible", { required: true })
const emit = defineEmits<{ save: [input: BackendServiceAccountInput] }>()

const title = ref("")
const description = ref("")

watch(
  () => [visible.value, serviceAccount] as const,
  () => {
    if (!visible.value) return

    title.value = serviceAccount?.meta.title ?? ""
    description.value = serviceAccount?.meta.description ?? ""
  },
  { immediate: true },
)

function save(): void {
  if (!title.value.trim()) return

  emit("save", {
    meta: {
      title: title.value.trim(),
      description: description.value.trim() || undefined,
    },
  })
}
</script>

<template>
  <VDialog v-model="visible" max-width="620">
    <VCard
      :title="
        serviceAccount ? 'Edit backend service account' : 'Create backend service account'
      "
      color="#2d2d2d"
    >
      <VCardText class="pt-4">
        <VTextField
          v-model="title"
          class="mb-4"
          label="Title"
          variant="outlined"
          density="compact"
          :rules="[value => !!value?.trim() || 'Title is required']"
          required
          autofocus
        />
        <VTextarea
          v-model="description"
          label="Description"
          variant="outlined"
          density="compact"
          rows="3"
        />
      </VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn :disabled="loading" @click="visible = false">Cancel</VBtn>
        <VBtn color="primary" :disabled="!title.trim()" :loading="loading" @click="save">Save</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
