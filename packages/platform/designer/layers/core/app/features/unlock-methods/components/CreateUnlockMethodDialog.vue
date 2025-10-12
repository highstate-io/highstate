<script setup lang="ts">
import UnlockMethodForm from "./UnlockMethodForm.vue"
import { createUnlockMethodFromForm, type UnlockMethodFormData } from "../business"

const visible = defineModel<boolean>("visible")

const emit = defineEmits<{
  created: []
}>()

const { settingsStore } = useProjectStores()

const valid = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const unlockMethodForm = ref<InstanceType<typeof UnlockMethodForm>>()

const formData = ref<UnlockMethodFormData>({
  type: "password",
  title: "",
  description: "",
  password: "",
  confirmPassword: "",
})

const handleCancel = () => {
  visible.value = false
  unlockMethodForm.value?.resetForm()
  error.value = null
}

const handleCreate = async () => {
  if (!valid.value) return

  loading.value = true
  error.value = null

  try {
    const unlockMethod = await createUnlockMethodFromForm(formData.value)

    await settingsStore.addUnlockMethod(unlockMethod)

    visible.value = false
    unlockMethodForm.value?.resetForm()
    error.value = null
    emit("created")
  } catch (err) {
    console.error("Failed to create unlock method:", err)
    error.value = "Some error occurred"
  } finally {
    loading.value = false
  }
}

// Reset form when dialog closes
watch(visible, newVisible => {
  if (!newVisible) {
    unlockMethodForm.value?.resetForm()
    error.value = null
  }
})
</script>

<template>
  <VDialog v-model="visible" max-width="600px">
    <VCard title="Create Unlock Method">
      <VCardText>
        <UnlockMethodForm
          ref="unlockMethodForm"
          @update:valid="valid = $event"
          @update:form="formData = $event"
        />

        <VAlert v-if="error" type="error" density="compact" class="mb-4">
          {{ error }}
        </VAlert>
      </VCardText>

      <VCardActions>
        <VSpacer />
        <VBtn :disabled="loading" @click="handleCancel">Cancel</VBtn>
        <VBtn color="primary" :disabled="!valid" :loading="loading" @click="handleCreate">
          Create
        </VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
