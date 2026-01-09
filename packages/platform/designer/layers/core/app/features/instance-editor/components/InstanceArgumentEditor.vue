<script setup lang="ts">
import {
  genericNameSchema,
  getInstanceId,
  text,
  type ComponentModel,
  type InstanceId,
  type InstanceModel,
} from "@highstate/contract"
import type { InstanceState } from "@highstate/backend/shared"
import { ComponentIcon } from "#layers/core/app/features/shared"
import ArgumentDescription from "./ArgumentDescription.vue"
import CodeArgumentInput from "./CodeArgumentInput.vue"
import GroupArgumentInput from "./GroupArgumentInput.vue"
import PlainArgumentInput from "./PlainArgumentInput.vue"
import { createEditorArguments, populateDefaultValues, removeDefaultValues } from "../business"

const { instance, component, allInstances } = defineProps<{
  instance: InstanceModel
  component: ComponentModel
  state?: InstanceState
  allInstances: Map<string, InstanceModel>
}>()

const editing = defineModel<boolean>()
const name = ref(instance.name)
const args = reactive(populateDefaultValues(instance.args ?? {}, component.args))

const cancel = async () => {
  editing.value = false
  await nextTick()
  Object.assign(args, instance.args)
}

const emit = defineEmits<{
  save: [instanceId: InstanceId, newName: string, newArgs: Record<string, unknown>]
}>()

const save = async () => {
  const newArgs = removeDefaultValues(args, component.args)
  emit("save", instance.id, name.value, newArgs)

  await nextTick()
  editing.value = false
}

const nameRules = [
  (v: string) => !!v || "Name is required",
  (v: string) =>
    v === instance.name ||
    !allInstances.has(getInstanceId(instance.type, v)) ||
    "Instance with this name and type already exists",
  (v: string) => {
    const result = genericNameSchema.safeParse(v)

    return result.success || result.error.issues[0].message
  },
]

const { plainArguments, expandableArguments } = createEditorArguments(
  component.type,
  component.args,
)

const nameValid = ref(true)

const nameDescription = text`
  The name of the instance. It must be unique within the same type across the project.
`
</script>

<template>
  <VDialog v-model="editing" class="dialog" fullscreen>
    <VCard
      variant="flat"
      :color="component.meta.color ?? '#2d2d2d'"
      :title="component.meta.title"
      :subtitle="component.meta.description"
    >
      <template #prepend>
        <ComponentIcon :meta="component.meta" />
      </template>

      <VDivider />

      <VCardText class="d-flex flex-column pt-4 ga-4 dialog-scroll">
        <VForm v-model="nameValid">
          <VTextField
            v-model="name"
            label="Name"
            variant="outlined"
            density="compact"
            :rules="nameRules"
          />

          <ArgumentDescription class="mt-2" :description="nameDescription" />
        </VForm>

        <PlainArgumentInput
          v-for="argument in plainArguments"
          :key="argument.name"
          v-model="args[argument.name]"
          :argument="argument"
          :instance="instance"
        />

        <VExpansionPanels v-if="expandableArguments.length > 0" :elevation="0">
          <template v-for="argument in expandableArguments" :key="argument.name">
            <GroupArgumentInput
              v-if="argument.kind === 'group'"
              v-model="args[argument.name]"
              :argument="argument"
              :instance="instance"
            />

            <CodeArgumentInput
              v-else
              v-model="args[argument.name]"
              :argument="argument"
              :instance="instance"
            />
          </template>
        </VExpansionPanels>
      </VCardText>

      <VDivider />

      <VCardActions class="d-flex py-0">
        <VSpacer />

        <VBtn @click="cancel">Cancel</VBtn>
        <VBtn @click="save" color="primary" :disabled="!nameValid">Save</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>

<style scoped>
.dialog {
  width: min(100vw, 1200px);
  max-height: 80vh;
}

.dialog-scroll {
  max-height: 80vh;
  overflow-y: auto;
}

@media (max-width: 1000px) {
  .dialog {
    max-height: 100vh;
  }

  .dialog-scroll {
    max-height: 100vh;
  }
}
</style>
