<script setup lang="ts">
import type { InstanceModel, UnitModel } from "@highstate/contract"
import { ComponentIcon } from "#layers/core/app/features/shared"
import CodeArgumentInput from "./CodeArgumentInput.vue"
import GroupArgumentInput from "./GroupArgumentInput.vue"
import PlainArgumentInput from "./PlainArgumentInput.vue"
import { createEditorArguments, populateDefaultValues, removeDefaultValues } from "../business"
import type { InstanceState } from "@highstate/backend"

const { component, state, initialSecrets } = defineProps<{
  instance: InstanceModel
  state: InstanceState
  component: UnitModel
  initialSecrets: Record<string, unknown>
}>()

const editing = defineModel<boolean>()
const secrets = reactive(populateDefaultValues(initialSecrets, component.secrets))

const emit = defineEmits<{
  save: [stateId: string, secretValues: Record<string, unknown>]
}>()

const cancel = async () => {
  editing.value = false
  await nextTick()
  Object.assign(secrets, initialSecrets)
}

const save = async () => {
  const secretValues = removeDefaultValues(secrets, component.secrets)

  emit("save", state.id, secretValues)

  await nextTick()
  editing.value = false
}

const { plainArguments, expandableArguments } = createEditorArguments(
  component.type,
  component.secrets,
)
</script>

<template>
  <VDialog v-model="editing" class="dialog">
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

      <VCardText class="d-flex flex-column pt-4 ga-4" style="max-height: 60vh; overflow: scroll">
        <PlainArgumentInput
          v-for="argument in plainArguments"
          :key="argument.name"
          v-model="secrets[argument.name]"
          :argument="argument"
          :instance="instance"
          is-secret
        />

        <VExpansionPanels v-if="expandableArguments.length > 0" :elevation="0">
          <template v-for="argument in expandableArguments" :key="argument.name">
            <GroupArgumentInput
              v-if="argument.kind === 'group'"
              :argument="argument"
              :instance="instance"
              v-model="secrets[argument.name]"
              is-secret
            />

            <CodeArgumentInput
              v-else
              v-model="secrets[argument.name]"
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
        <VBtn @click="save" color="primary">Save</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>

<style scoped>
.dialog {
  width: 1200px;
}
</style>
