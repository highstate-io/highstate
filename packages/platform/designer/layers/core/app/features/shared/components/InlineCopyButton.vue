<script setup lang="ts">
const { content } = defineProps<{
  content: string
}>()

const { copy, copied } = useClipboard()

const icon = computed(() => (copied.value ? "mdi-check" : "mdi-content-copy"))
</script>

<template>
  <VBtn size="small" variant="text" class="copy-button d-flex ml-1" @click="copy(content)">
    <VIcon :size="16">{{ icon }}</VIcon>
  </VBtn>
</template>

<style scoped>
.copy-button {
  min-width: 0;
  width: 12px;
  height: 16px !important;
  align-self: center;
}
</style>
