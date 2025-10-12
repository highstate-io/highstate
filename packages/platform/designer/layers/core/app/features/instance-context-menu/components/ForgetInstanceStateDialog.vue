<script setup lang="ts">
import type { ComponentModel, InstanceModel } from "@highstate/contract"

const visible = defineModel<boolean>("visible")

const { stateStore } = useProjectStores()

const { instance, component } = defineProps<{
  instance: InstanceModel
  component: ComponentModel
}>()
const loading = ref(false)
const deleteSecrets = ref(false)
const clearTerminalData = ref(false)

const forgetState = async () => {
  loading.value = true

  try {
    await stateStore.forgetInstanceState(instance.id, deleteSecrets.value, clearTerminalData.value)

    visible.value = false
  } finally {
    loading.value = false
  }
}

const title = computed(() => `Forget state of ${component.meta.title} "${instance.name}"`)
</script>

<template>
  <VDialog v-model="visible" max-width="600px">
    <VCard :title="title" color="#2d2d2d">
      <VCardText>
        <div>
          Are you sure you want to forget the state of this instance including Pulumi state?
        </div>

        <VCheckbox
          v-model="deleteSecrets"
          label="Delete all secrets associated with this instance"
          density="compact"
          hide-details
        />

        <VCheckbox
          v-model="clearTerminalData"
          label="Clear all terminal data associated with this instance"
          density="compact"
          hide-details
        />

        <VAlert density="compact" type="warning" variant="outlined" class="mt-4">
          <div>
            No destroy operation will be performed, so all resources will be left in place and
            unreachable by HighState.
          </div>
          <div>
            You should only use this operation when the instance is unreachable/unrecoverable and
            you want to start from scratch.
          </div>
        </VAlert>
      </VCardText>

      <VCardActions>
        <VSpacer />
        <VBtn @click="visible = false">Cancel</VBtn>
        <VBtn :loading="loading" @click="forgetState">Forget State</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
