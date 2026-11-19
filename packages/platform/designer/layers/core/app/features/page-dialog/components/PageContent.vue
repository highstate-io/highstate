<script setup lang="ts">
import { bytesToHumanReadable, type File, type PageBlock } from "@highstate/contract"
import { Icon } from "@iconify/vue"
import VueQrcode from "vue-qrcode"
import { getFileUrl } from "../business"

defineProps<{
  content: PageBlock[]
}>()

const route = useRoute()
const projectId = route.params.projectId as string
const access = useAccess()
const failure = ref<string>()

const download = async (file: File) => {
  failure.value = undefined

  try {
    const response = await fetch(getFileUrl(file, projectId))
    if (!response.ok) {
      throw Object.assign(new Error("The file could not be downloaded"), {
        statusCode: response.status,
      })
    }

    const url = URL.createObjectURL(await response.blob())
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = file.meta.name
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) {
    access.reject(error, "artifact download", { projectId })
    failure.value = accessError(error)?.message ?? "The file could not be downloaded."
  }
}

const qrCodeColor = {
  dark: "#000000",
  light: "#ffffff",
}

const renderQrContent = (content: string, language?: string) => {
  if (language) {
    return renderMarkdown(`\`\`\`${language}\n${content}\n\`\`\``)
  }

  return renderMarkdown(`\`\`\`\n${content}\n\`\`\``)
}
</script>

<template>
  <!-- eslint-disable vue/no-v-html -->

  <div class="d-flex gr-4 flex-column">
    <AccessNotice v-if="failure" title="Download unavailable" :message="failure" />
    <template v-for="(block, index) in content" :key="index">
      <div
        v-if="block.type === 'markdown'"
        class="md-content"
        v-html="renderMarkdown(block.content)"
      />

      <div v-else-if="block.type === 'qr'" class="d-flex flex-row ga-8">
        <div v-if="block.showContent" class="d-flex qr-text">
          <div v-html="renderQrContent(block.content, block.language)" />
        </div>
        <div class="d-flex justify-center align-center">
          <VueQrcode
            class="qr"
            type="image/png"
            :color="qrCodeColor"
            :value="block.content"
            :width="300"
            :height="300"
          />
        </div>
      </div>

      <v-card
        v-else-if="block.type === 'file'"
        variant="text"
        class="d-flex align-center ga-2 pt-2 pb-2 text-decoration-none"
      >
        <v-avatar color="primary" size="42" class="elevation-1">
          <Icon color="white" :width="24" :icon="getFileIcon(block.file.meta)" />
        </v-avatar>

        <div class="ms-3 d-flex flex-column">
          <div class="text-body-1 font-weight-medium text-truncate">{{ block.file.meta.name }}</div>
          <div v-if="block.file.meta.size !== undefined" class="text-caption text-secondary">
            {{ bytesToHumanReadable(block.file.meta.size) }}
          </div>
        </div>

        <v-spacer />

        <v-btn
          v-access="block.file.content.type === 'artifact' ? { permission: 'artifact.get', projectId, target: { artifactHash: block.file.content.hash } } : undefined"
          icon
          variant="text"
          @click="download(block.file)"
        >
          <v-icon>mdi-download</v-icon>
        </v-btn>
      </v-card>
    </template>
  </div>
</template>

<style scoped>
.qr {
  width: calc(min(300px, 30vw));
  height: calc(min(300px, 30vw));
}

.qr-text {
  overflow: scroll;
}
</style>

<style>
@import "highlight.js/styles/atom-one-dark.css";

.hljs {
  background-color: #2d2d2d;
  padding: 0 !important;
}
</style>
