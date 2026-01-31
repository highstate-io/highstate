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

if (model.value === undefined) {
  model.value = argument.default ?? {}
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

// also fill defaults for fields since for some reason they cannot be filled by handleModelChange
for (const field of argument.fields[discriminatorValue.value] ?? []) {
  if (model.value[field.name] === undefined && field.default !== undefined) {
    model.value[field.name] = field.default
  }
}

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
    </template>

    <template #text>
      <ArgumentDescription
        v-if="argument.description"
        :description="argument.description"
        class="mb-4"
      />

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
