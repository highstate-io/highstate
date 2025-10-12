<script setup lang="ts">
import { PreviewCanvas } from "#layers/core/app/features/canvas"
import {
  getRuntimeInstances,
  resetEvaluation,
  setValidationEnabled,
  type ComponentModel,
  type EntityModel,
} from "@highstate/contract"

const route = useRoute("preview-snippet-snippet")

// to allow empty values in demonstration purposes
setValidationEnabled(false)

// for HMR
resetEvaluation()

const modules = import.meta.glob("~/snippets/**/*.preview.ts")
const module = modules[`/snippets/${route.params.snippet.replaceAll("_", "/")}.preview.ts`]

if (module) {
  await module()
}

const instances = getRuntimeInstances()

const components: Record<string, ComponentModel> = {}
const entities: Record<string, EntityModel> = {}

for (const { instance, component } of instances) {
  components[instance.type] = component.model
  for (const entity of component.entities.values()) {
    entities[entity.type] = entity.model
  }
}

onMounted(() => {
  window.parent.postMessage({
    type: "preview-ready",
    snippet: route.params.snippet,
  })
})
</script>

<template>
  <PreviewCanvas
    v-if="module as unknown"
    :instances="instances.map(instance => instance.instance)"
    :components="components"
    :entities="entities"
    style="width: 100vw; height: 100vh"
  />
  <div v-else class="d-flex align-center justify-center" style="height: 100vh; width: 100vw">
    <div class="text-secondary text-center">
      Snippet
      <strong>{{ route.params.snippet }}</strong>
      is not found.
      <br />
    </div>
  </div>
</template>

<style>
@import "vuetify/styles";
@import "../../../../../designer/layers/core/app/assets/main.css";
</style>
