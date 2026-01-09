<script setup lang="ts">
const { blueprint, height = "500px" } = defineProps<{
  blueprint: string
  height?: string
}>()

const cardRef = ref<HTMLElement | null>(null)
const loaded = ref(false)
const shouldLoad = ref(false)
const isVisible = useElementVisibility(cardRef)
const normalizedBlueprint = blueprint.replaceAll("/", "_")
const previewUrl = `/preview/blueprint/${normalizedBlueprint}`

useEventListener("message", (event: MessageEvent) => {
  if (event.data.type === "preview-ready" && event.data.blueprint === normalizedBlueprint) {
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
