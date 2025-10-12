<script setup lang="ts">
defineProps<{
  item: string
}>()

const { copy, copied } = useClipboard()

const icon = computed(() => (copied.value ? "mdi-check" : "mdi-content-copy"))
</script>

<template>
  <VListItem :title="item">
    <template #append>
      <VBtn size="small" variant="text" class="copy-button ml-1" @click="copy(item)">
        <VIcon :size="16">{{ icon }}</VIcon>
      </VBtn>
    </template>
  </VListItem>
</template>

<style scoped>
.copy-button {
  min-width: 0;
  width: 12px;
  height: 16px;
  align-self: center;
}
</style>
