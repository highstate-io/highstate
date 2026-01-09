<script setup lang="ts">
type PreviewKind = "snippet" | "blueprint"

const {
  type,
  id,
  title,
  height = "500px",
} = defineProps<{
  type: PreviewKind
  id: string
  title: string
  height?: string
}>()

const renderer = useSharedPreviewRenderer()

const cardRef = ref<HTMLElement | null>(null)
const shouldLoad = ref(false)
const isVisible = useElementVisibility(cardRef)

const normalizedId = computed(() => id.replaceAll("/", "_"))

const thumbnailUrl = ref<string>("")
const loaded = computed(() => thumbnailUrl.value.length > 0)

const requestThumbnail = async () => {
  const heightPx = Number.parseInt(height, 10)
  const safeHeight = Number.isFinite(heightPx) ? heightPx : 500

  thumbnailUrl.value = await renderer.requestThumbnail(
    {
      kind: type,
      id: normalizedId.value,
    },
    {
      width: 1024,
      height: safeHeight,
    },
  )
}

const openInteractive = async () => {
  await renderer.openInteractive({
    kind: type,
    id: normalizedId.value,
    title,
  })
}

watch(
  isVisible,
  value => {
    if (value) {
      shouldLoad.value = true
    }
  },
  { immediate: true },
)

watch(
  shouldLoad,
  async value => {
    if (!value || loaded.value) {
      return
    }

    await requestThumbnail()
  },
  { immediate: true },
)
</script>

<template>
  <UCard ref="cardRef" class="preview-card">
    <USkeleton v-if="!loaded" :style="{ height }" />
    <button
      v-if="shouldLoad && loaded"
      type="button"
      class="preview-button"
      :style="{ height }"
      @click="openInteractive"
    >
      <img class="preview-image" :src="thumbnailUrl" :alt="title" />
      <div class="preview-overlay">Click to open</div>
    </button>
  </UCard>
</template>

<style scoped>
.preview-card > :deep(div) {
  padding: 0 !important;
}

.preview-button {
  width: 100%;
  padding: 0;
  border: 0;
  display: block;
  position: relative;
  cursor: pointer;
  background: transparent;
}

.preview-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.preview-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.92);
  background: rgba(0, 0, 0, 0.18);
  opacity: 0;
  transition: opacity 120ms ease;
  font-weight: 600;
}

.preview-button:hover .preview-overlay {
  opacity: 1;
}
</style>
