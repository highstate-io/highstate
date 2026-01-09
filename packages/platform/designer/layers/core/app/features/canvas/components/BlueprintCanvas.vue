<script setup lang="ts">
import type { ComponentModel, EntityModel } from "@highstate/contract"
import type { Blueprint } from "#layers/core/app/features/blueprint/business/shared"
import PreviewCanvas from "./PreviewCanvas.vue"

const emit = defineEmits<{
  ready: []
}>()

const {
  blueprint,
  components = {},
  entities = {},
} = defineProps<{
  blueprint: Blueprint
  components?: Record<string, ComponentModel>
  entities?: Record<string, EntityModel>
}>()

// merge components with blueprint components taking precedence
const mergedComponents = computed(() => {
  const blueprintComponents: Record<string, ComponentModel> = {}

  if (blueprint.components) {
    for (const component of blueprint.components) {
      blueprintComponents[component.type] = component
    }
  }

  return {
    ...components,
    ...blueprintComponents,
  }
})

// merge entities with blueprint entities taking precedence
const mergedEntities = computed(() => {
  const blueprintEntities: Record<string, EntityModel> = {}

  if (blueprint.entities) {
    for (const entity of blueprint.entities) {
      blueprintEntities[entity.type] = entity
    }
  }

  return {
    ...entities,
    ...blueprintEntities,
  }
})
</script>

<template>
  <PreviewCanvas
    :instances="blueprint.instances"
    :hubs="blueprint.hubs"
    :components="mergedComponents"
    :entities="mergedEntities"
    :auto-position="false"
    @ready="emit('ready')"
  />
</template>
