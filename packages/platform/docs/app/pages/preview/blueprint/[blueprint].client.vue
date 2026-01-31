<script setup lang="ts">
import { BlueprintCanvas } from "#layers/core/app/features/canvas"
import { type Blueprint } from "#layers/core/app/features/blueprint/business/shared"
import { loadLibrary } from "~/utils/loadLibrary"

const route = useRoute("preview-blueprint-blueprint")

const modules = import.meta.glob("~/snippets/**/*.blueprint.json")
const blueprintId = atob(route.params.blueprint as string)
const module = modules[`/snippets/${blueprintId}.blueprint.json`]

const { components, entities } = await loadLibrary()
const blueprint = module ? ((await module()) as Blueprint) : null

onMounted(() => {
  window.parent.postMessage({
    type: "preview-ready",
    blueprintId,
  })
})
</script>

<template>
  <BlueprintCanvas
    v-if="blueprint"
    :blueprint="blueprint"
    :components="components"
    :entities="entities"
    :interactive="route.query.interactive === 'true'"
    style="width: 100vw; height: 100vh"
  />
  <div v-else class="d-flex align-center justify-center" style="height: 100vh; width: 100vw">
    <div class="text-secondary text-center">
      Blueprint
      <strong>{{ blueprintId }}</strong>
      is not found.
      <br />
    </div>
  </div>
</template>

<style>
@import "vuetify/styles";
@import "../../../../../designer/layers/core/app/assets/main.css";
</style>
