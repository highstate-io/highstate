<script setup lang="ts">
type DesignerPreviewType = "snippet" | "blueprint"

const { title, type, id } = defineProps<{
  title: string
  type: DesignerPreviewType
  id: string
}>()

const loaded = ref(false)
const previewUrl = `/preview/${type}/${btoa(id)}?interactive=true`

const startLoading = () => {
  loaded.value = false
}

useEventListener("message", (event: MessageEvent) => {
  const data: Record<string, unknown> = event.data
  if (!data || typeof data !== "object") {
    return
  }

  if (data.type === "preview-ready" && type === "snippet" && data.snippetId === id) {
    loaded.value = true
  }

  if (data.type === "preview-ready" && type === "blueprint" && data.blueprintId === id) {
    loaded.value = true
  }
})
</script>

<template>
  <div>
    <UModal :title="title" fullscreen class="modal" style="padding: 0">
      <div class="group relative inline-block cursor-pointer" @click="startLoading">
        <img
          :src="`/thumbnails/${type}s/${id}.png`"
          :alt="title"
          class="border border-default transition-opacity group-hover:opacity-60"
        />
        <div
          class="absolute inset-x-0 bottom-0 px-2 py-2 text-center text-xl opacity-0 transition-opacity group-hover:opacity-100"
        >
          Click to open
        </div>
      </div>

      <template #body>
        <div class="w-full h-full bg-default preview-dialog-content">
          <USkeleton v-if="!loaded" class="w-full h-full" />
          <iframe class="w-full h-full" :src="previewUrl" :class="{ hidden: !loaded }"></iframe>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.hidden {
  display: none;
}
</style>

<style>
:has(> .preview-dialog-content) {
  padding: 0;
}
</style>
