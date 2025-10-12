<script setup lang="ts">
import type { UnlockMethodOutput } from "@highstate/backend/shared"

const visible = defineModel<boolean>("visible")

const props = defineProps<{
  unlockMethod: UnlockMethodOutput | null
}>()

const emit = defineEmits<{
  confirm: [unlockMethod: UnlockMethodOutput]
}>()

const loading = ref(false)

const handleConfirm = () => {
  if (props.unlockMethod) {
    emit("confirm", props.unlockMethod)
  }
}

const handleCancel = () => {
  visible.value = false
}
</script>

<template>
  <VDialog v-model="visible" max-width="500px">
    <VCard v-if="unlockMethod">
      <VCardTitle class="d-flex align-center">
        <VIcon class="mr-2 text-error">mdi-alert-circle-outline</VIcon>
        Delete Unlock Method
      </VCardTitle>

      <VCardText>
        <p class="mb-3">
          Are you sure you want to delete the unlock method
          <strong>"{{ unlockMethod.meta.title }}"</strong>
          ?
        </p>

        <VAlert type="warning" density="compact">
          <strong>Warning:</strong>
          Deleting this unlock method will permanently remove your ability to unlock the project
          using this method. Make sure you have at least one other unlock method configured before
          proceeding.
        </VAlert>
      </VCardText>

      <VCardActions>
        <VSpacer />
        <VBtn :disabled="loading" @click="handleCancel">Cancel</VBtn>
        <VBtn color="error" :loading="loading" @click="handleConfirm">Delete</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
