<script setup lang="ts">
import { ref } from "vue"

const props = defineProps<{
  secretId: string
  projectId: string
}>()

const { $client } = useNuxtApp()

// state for managing revealed secrets
const isRevealed = ref(false)
const isLoading = ref(false)
const secretValue = ref<unknown>(null)
const showJsonDialog = ref(false)

/**
 * toggle secret visibility - reveal or hide the secret value
 */
const toggleSecretVisibility = async () => {
  if (isRevealed.value) {
    // hide the secret
    isRevealed.value = false
    secretValue.value = null
    return
  }

  // reveal the secret
  try {
    isLoading.value = true

    secretValue.value = await $client.settings.getSecretValue.query({
      projectId: props.projectId,
      secretId: props.secretId,
    })
    isRevealed.value = true
  } catch (error) {
    console.error("Failed to reveal secret:", error)
    // TODO: Show user-friendly error message
  } finally {
    isLoading.value = false
  }
}

/**
 * copy secret value to clipboard
 */
const copySecretValue = async () => {
  if (secretValue.value === undefined || secretValue.value === null) return

  try {
    let textToCopy: string
    if (typeof secretValue.value === "string") {
      textToCopy = secretValue.value
    } else {
      textToCopy = JSON.stringify(secretValue.value, null, 2)
    }

    await navigator.clipboard.writeText(textToCopy)
    // TODO: Show success toast
  } catch (error) {
    console.error("Failed to copy secret:", error)
    // TODO: Show error toast
  }
}

/**
 * show secret value in a dialog for complex data structures
 */
const showSecretInDialog = () => {
  if (secretValue.value === undefined || secretValue.value === null) return
  showJsonDialog.value = true
}

/**
 * format secret value for display
 */
const formatSecretValue = () => {
  if (secretValue.value === undefined || secretValue.value === null) return ""

  if (typeof secretValue.value === "string") {
    return secretValue.value
  }

  return JSON.stringify(secretValue.value)
}

/**
 * check if secret value is a complex object that should show a dialog
 */
const isComplexValue = computed(() => {
  return secretValue.value !== undefined && secretValue.value !== null && typeof secretValue.value !== "string"
})

/**
 * copy JSON dialog content to clipboard
 */
const copyJsonDialogContent = async () => {
  try {
    const textToCopy = JSON.stringify(secretValue.value, null, 2)
    await navigator.clipboard.writeText(textToCopy)
    // TODO: Show success toast
  } catch (error) {
    console.error("Failed to copy JSON content:", error)
    // TODO: Show error toast
  }
}
</script>

<template>
  <div class="d-flex align-center gap-2">
    <!-- Secret Value Display -->
    <div
      v-if="!isRevealed"
      class="secret-blur"
      :class="{ 'secret-loading': isLoading }"
      @click="toggleSecretVisibility"
    >
      <span v-if="isLoading" class="text-caption">Loading...</span>
      <span v-else class="secret-placeholder">••••••••••••</span>
    </div>

    <!-- Revealed Value -->
    <div v-else class="d-flex align-center gap-2">
      <div
        class="secret-revealed"
        :class="{ 'secret-clickable': isComplexValue }"
        @click="isComplexValue ? showSecretInDialog() : toggleSecretVisibility()"
      >
        <code class="text-caption">
          {{ formatSecretValue().slice(0, 50) }}
          <span v-if="formatSecretValue().length > 50">...</span>
        </code>
      </div>

      <!-- Action Buttons -->
      <VBtn size="x-small" variant="text" icon="mdi-content-copy" @click="copySecretValue" />
      <VBtn
        v-if="!isComplexValue"
        size="x-small"
        variant="text"
        icon="mdi-eye-off"
        @click="toggleSecretVisibility"
      />
    </div>
  </div>

  <!-- JSON Dialog -->
  <VDialog v-model="showJsonDialog" max-width="800">
    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between">
        <span>Secret Value</span>
        <VBtn icon="mdi-close" variant="text" size="small" @click="showJsonDialog = false" />
      </VCardTitle>
      <VCardText>
        <pre class="json-content">{{ JSON.stringify(secretValue, null, 2) }}</pre>
      </VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn variant="text" @click="copyJsonDialogContent">Copy</VBtn>
        <VBtn color="primary" @click="showJsonDialog = false">Close</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>

<style scoped>
.secret-blur {
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(var(--v-theme-surface-variant), 0.3);
  backdrop-filter: blur(4px);
  border: 1px dashed rgba(var(--v-theme-outline), 0.5);
  transition: all 0.2s ease;
  min-width: 120px;
  text-align: center;
}

.secret-blur:hover {
  background: rgba(var(--v-theme-surface-variant), 0.5);
  border-color: rgba(var(--v-theme-primary), 0.7);
}

.secret-loading {
  cursor: not-allowed;
  opacity: 0.6;
}

.secret-placeholder {
  font-family: monospace;
  letter-spacing: 2px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.secret-revealed {
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(var(--v-theme-success), 0.1);
  border: 1px solid rgba(var(--v-theme-success), 0.3);
  max-width: 300px;
  overflow: hidden;
}

.secret-clickable {
  cursor: pointer;
}

.secret-clickable:hover {
  background: rgba(var(--v-theme-success), 0.2);
}

.json-content {
  background: rgb(var(--v-theme-surface-variant));
  padding: 16px;
  border-radius: 4px;
  overflow-x: auto;
  font-family: "Courier New", monospace;
  font-size: 12px;
  line-height: 1.4;
}
</style>