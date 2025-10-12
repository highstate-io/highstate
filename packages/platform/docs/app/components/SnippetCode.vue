<script setup lang="ts">
const { snippet } = defineProps<{
  snippet: string
}>()

const modules = import.meta.glob("~/snippets/**/*.ts", { query: "?raw" })
const snippetContent = await modules[`/snippets/${snippet}.ts`]()

const mdc = `
\`\`\`
${(snippetContent as any).default.trim()}
\`\`\`
`
</script>

<template>
  <MDC :value="mdc" />
</template>
