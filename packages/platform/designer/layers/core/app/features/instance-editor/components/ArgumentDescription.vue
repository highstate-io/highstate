<script setup lang="ts">
defineProps<{
  description: string
}>()
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="markdown-body pl-4 text-disabled" v-html="renderMarkdown(description)" />
</template>

<style>
.markdown-body ul {
  list-style: disc;
  padding-left: 1.5rem;
}
</style>
