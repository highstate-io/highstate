<script setup lang="ts">
import type { InstanceModel } from "@highstate/contract"
import type { GroupEditorArgument } from "../business"
import PlainArgumentInput from "./PlainArgumentInput.vue"
import ArgumentDescription from "./ArgumentDescription.vue"

const model = defineModel<any>()

const { argument, isSecret } = defineProps<{
  argument: GroupEditorArgument
  instance: InstanceModel
  isSecret?: boolean
}>()

if (model.value === undefined && argument.default !== undefined) {
  model.value = argument.default ?? {}
} else if (model.value === undefined) {
  model.value = {}
}

const handleModelChange = (key: string, value: any) => {
  model.value = { ...model.value, [key]: value }
}

const discriminatorValue = computed(() => {
  if (argument.discriminator) {
    return model.value[argument.discriminator.name] ?? ""
  }

  return ""
})

watch(discriminatorValue, newValue => {
  if (!argument.discriminator) {
    return
  }

  const fields = argument.fields[newValue] ?? []
  const newModel: Record<string, unknown> = {
    [argument.discriminator.name]: newValue,
  }

  // reset the whole model
  for (const field of fields) {
    newModel[field.name] = field.default
  }

  model.value = newModel
})
</script>

<template>
  <VExpansionPanel color="#2d2d2d" bg-color="#2d2d2d">
    <template #title>
      <div>{{ argument.title }}</div>
      <ArgumentDescription v-if="argument.description" :description="argument.description" />
    </template>

    <template #text>
      <div class="d-flex flex-column ga-4">
        <!-- 1. static argument group -->
        <template v-if="!argument.discriminator">
          <PlainArgumentInput
            v-for="field in argument.fields['']"
            :model-value="model[field.name]"
            :key="field.name"
            :argument="field"
            :instance="instance"
            :is-secret="isSecret"
            @update:model-value="handleModelChange(field.name, $event)"
          />
        </template>

        <!-- 2. discriminated union argument group -->
        <template v-else>
          <!-- <VBtnToggle
      :model-value="discriminatorValue"
      mandatory
      variant="outlined"
      density="compact"
      divided
      class="w-100 mb-6"
      style="min-height: 40px"
      @update:model-value="handleModelChange(argument.discriminator.name, $event)"
    >
      <VBtn
        v-for="fieldName in Object.keys(argument.fields)"
        :key="fieldName"
        :value="fieldName"
        class="flex-grow-1"
      >
        {{ fieldName }}
      </VBtn>
    </VBtnToggle> -->

          <div>
            <VSelect
              :model-value="model[argument.discriminator.name]"
              :items="Object.keys(argument.fields)"
              :label="argument.discriminator.title"
              variant="outlined"
              density="compact"
              hide-details
              @update:model-value="handleModelChange(argument.discriminator.name, $event)"
            />

            <ArgumentDescription
              v-if="argument.discriminator.description"
              class="mt-2"
              :description="argument.discriminator.description"
            />
          </div>

          <PlainArgumentInput
            v-for="field in argument.fields[discriminatorValue] ?? []"
            :model-value="model[field.name]"
            :key="field.name"
            :argument="field"
            :instance="instance"
            :is-secret="isSecret"
            @update:model-value="handleModelChange(field.name, $event)"
          />
        </template>
      </div>
    </template>
  </VExpansionPanel>
</template>
