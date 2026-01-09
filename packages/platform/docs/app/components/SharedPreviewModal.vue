<script setup lang="ts">
const renderer = useSharedPreviewRenderer()
const hostUrl = useSharedPreviewHostUrl()

const iframeRef = ref<HTMLIFrameElement | null>(null)

const close = () => {
  renderer.closeInteractive()
}

onMounted(() => {
  renderer.setHostFrame(iframeRef.value)
})
</script>

<template>
  <div class="shared-preview-root">
    <!-- Always-mounted host for the single iframe. -->
    <div
      class="shared-preview-iframe-host"
      :class="{ 'is-modal-open': renderer.isModalOpen.value }"
    >
      <iframe ref="iframeRef" class="shared-preview-iframe" :src="hostUrl" title="Preview" />
    </div>

    <div v-show="renderer.isModalOpen.value" class="shared-preview-overlay" @click.self="close">
      <div class="shared-preview-modal" role="dialog" aria-modal="true">
        <div class="shared-preview-header">
          <div class="shared-preview-title">
            Preview
            <span v-if="renderer.modalTarget.value?.title" class="shared-preview-subtitle">
              {{ renderer.modalTarget.value.title }}:{{ renderer.modalTarget.value.id }}
            </span>
          </div>

          <button type="button" class="shared-preview-close" @click="close">Close</button>
        </div>

        <div class="shared-preview-body" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.shared-preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.shared-preview-modal {
  width: min(1400px, 96vw);
  height: min(900px, 92vh);
  background: rgb(17, 19, 24);
  color: rgba(255, 255, 255, 0.92);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.shared-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.shared-preview-title {
  font-weight: 600;
}

.shared-preview-subtitle {
  font-weight: 400;
  opacity: 0.65;
  margin-left: 8px;
}

.shared-preview-close {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
}

.shared-preview-close:hover {
  background: rgba(255, 255, 255, 0.1);
}

.shared-preview-close:active {
  background: rgba(255, 255, 255, 0.14);
}

.shared-preview-body {
  flex: 1;
  overflow: hidden;
  background: rgb(10, 12, 16);
}

.shared-preview-iframe {
  width: 100%;
  height: 100%;
  border: 0;
}

.shared-preview-iframe-host {
  position: fixed;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
  left: -10000px;
  top: -10000px;
}

.shared-preview-iframe-host.is-modal-open {
  position: absolute;
  inset: 0;
  width: auto;
  height: auto;
  opacity: 1;
  pointer-events: auto;
  left: auto;
  top: auto;
}

.shared-preview-root {
  display: contents;
}
</style>
