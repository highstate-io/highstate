<script setup lang="ts">
import type { ComponentModel, EntityModel, InstanceInput, InstanceModel } from "@highstate/contract"
import type { ValidConnectionFunc } from "@vue-flow/core"
import InstanceNodeIOSide from "./InstanceNodeIOSide.vue"
import type { ResolvedInstanceInput } from "@highstate/backend/shared"

const { type = "both" } = defineProps<{
  instance: InstanceModel
  component: ComponentModel
  entities: Record<string, EntityModel | undefined>
  type?: "inputs" | "outputs" | "both"
  mirror?: boolean
  isValidConnection?: ValidConnectionFunc
  usedOutputs?: Set<string>
  resolvedInputs?: Record<string, ResolvedInstanceInput[]>
  resolvedInjectionInput?: InstanceInput[]
  forceShowAllHandles?: boolean
  preventShowAllHandles?: boolean
}>()
</script>

<template>
  <VCardActions class="align-start align-stretch component-node-io">
    <template v-if="!mirror">
      <InstanceNodeIOSide
        v-if="type === 'both' || type === 'inputs'"
        :instance="instance"
        :component="component"
        :entities="entities"
        :is-valid-connection="isValidConnection"
        type="inputs"
        :resolved-inputs="resolvedInputs"
        :resolved-injection-input="resolvedInjectionInput"
        :force-show-all-handles="forceShowAllHandles"
        :prevent-show-all-handles="preventShowAllHandles"
        side="left"
      />

      <VSpacer />

      <InstanceNodeIOSide
        v-if="type === 'both' || type === 'outputs'"
        :instance="instance"
        :component="component"
        :entities="entities"
        :is-valid-connection="isValidConnection"
        type="outputs"
        :used-outputs="usedOutputs"
        side="right"
        :force-show-all-handles="forceShowAllHandles"
        :prevent-show-all-handles="preventShowAllHandles"
      />
    </template>

    <template v-else>
      <InstanceNodeIOSide
        v-if="type === 'both' || type === 'outputs'"
        :instance="instance"
        :component="component"
        :entities="entities"
        :is-valid-connection="isValidConnection"
        type="outputs"
        :used-outputs="usedOutputs"
        side="left"
        :force-show-all-handles="forceShowAllHandles"
        :prevent-show-all-handles="preventShowAllHandles"
      />

      <VSpacer />

      <InstanceNodeIOSide
        v-if="type === 'both' || type === 'inputs'"
        :instance="instance"
        :component="component"
        :entities="entities"
        :is-valid-connection="isValidConnection"
        type="inputs"
        side="right"
        :resolved-inputs="resolvedInputs"
        :force-show-all-handles="forceShowAllHandles"
        :prevent-show-all-handles="preventShowAllHandles"
      />
    </template>
  </VCardActions>
</template>

<style scoped>
.component-node-io {
  min-height: 48px;
}
</style>
