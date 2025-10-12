<script setup lang="ts">
import ComponentPageContent from "./PageContent.vue"
import type { CommonObjectMeta, PageBlock } from "@highstate/contract"

const visible = defineModel<boolean>("visible")

defineProps<{
  meta: CommonObjectMeta
  content: PageBlock[]
}>()
</script>

<template>
  <VDialog v-model="visible" max-width="80vh" max-height="60vh">
    <VCard :title="meta.title" color="#2d2d2d">
      <VCardText style="overflow-y: scroll">
        <ComponentPageContent :content="content" />
      </VCardText>

      <VCardActions>
        <VSpacer />
        <VBtn @click="visible = false">Close</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
