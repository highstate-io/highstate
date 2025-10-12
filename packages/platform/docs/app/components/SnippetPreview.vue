<script setup lang="ts">
const { snippet, height = "500px" } = defineProps<{
  snippet: string
  height?: string
}>()

const cardRef = ref<HTMLElement | null>(null)
const loaded = ref(false)
const shouldLoad = ref(false)
const isVisible = useElementVisibility(cardRef)
const normalizedSnippet = snippet.replaceAll("/", "_")
const previewUrl = `/preview/snippet/${normalizedSnippet}`

useEventListener("message", (event: MessageEvent) => {
  if (event.data.type === "preview-ready" && event.data.snippet === normalizedSnippet) {
    loaded.value = true
  }
})

watch(
  isVisible,
  value => {
    if (value) {
      shouldLoad.value = true
    }
  },
  { immediate: true },
)
</script>

<template>
  <UCard ref="cardRef" class="preview-card">
    <USkeleton v-if="!loaded" :style="{ height }" />
    <iframe
      v-if="shouldLoad"
      class="w-full"
      :style="{ height }"
      :src="previewUrl"
      :class="{ hidden: !loaded }"
    ></iframe>
  </UCard>
</template>

<style scoped>
.preview-card > :deep(div) {
  padding: 0 !important;
}

.hidden {
  display: none;
}
</style>
