<script setup lang="ts">
import type { ComponentModel, InstanceModel } from "@highstate/contract"

const { instance, component } = defineProps<{
  instance: InstanceModel
  component: ComponentModel
}>()

type ArgumentToShow = {
  name: string
  value: string
  requiredAndNotSet: boolean
}

const argumentsToShow = computed(() => {
  const result: ArgumentToShow[] = []

  for (const [argName, arg] of Object.entries(component.args)) {
    if (
      !arg.required &&
      (instance.args?.[argName] == null || instance.args?.[argName] === arg.schema.default)
    ) {
      continue
    }

    result.push({
      name: arg.meta.title!,
      value: renderArgumentValue(instance.args?.[argName], arg.schema),
      requiredAndNotSet: arg.required && instance.args?.[argName] == null,
    })
  }

  return result
})
</script>

<template>
  <template v-if="argumentsToShow.length > 0">
    <VDivider />

    <VCardText class="d-flex flex-column gap-2 px-2 py-2">
      <div
        v-for="{ name, value, requiredAndNotSet } in argumentsToShow"
        :key="name"
        class="d-flex flex-row"
      >
        <div class="d-flex text-disabled text-start text-no-wrap">{{ name }}</div>
        <div v-if="requiredAndNotSet" class="d-flex ml-auto text-error">not set</div>
        <div v-else class="d-flex ml-auto text-truncate pl-4">{{ value }}</div>
      </div>
    </VCardText>
  </template>
</template>
