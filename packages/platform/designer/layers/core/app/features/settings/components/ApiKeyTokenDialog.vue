<script setup lang="ts">
import { InlineCopyButton } from "#layers/core/app/features/shared"

const { token } = defineProps<{ token: string }>()
const visible = defineModel<boolean>("visible", { required: true })
</script>

<template>
  <VDialog v-model="visible" max-width="680" persistent>
    <VCard title="API key token">
      <VCardText>
        <VAlert type="warning" variant="tonal" class="mb-4">
          Copy this token now. It will not be shown again.
        </VAlert>
        <div class="d-flex align-center token-value pa-3">
          <code>{{ token }}</code>
          <VSpacer />
          <InlineCopyButton :content="token" />
        </div>
      </VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn color="primary" @click="visible = false">I have copied the token</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>

<style scoped>
.token-value {
  min-width: 0;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
}

code {
  overflow-wrap: anywhere;
}
</style>
