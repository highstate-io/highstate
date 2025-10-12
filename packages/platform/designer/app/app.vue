<script setup lang="ts">
import { DockviewVue, type DockviewReadyEvent } from "dockview-vue"
import { themeDark } from "dockview-core"
import { CustomTab, GenericPanel } from "#layers/core/app/features/shared"
import { LayoutResetButton } from "#layers/core/app/features/main-menu"

const initialized = ref(false)
const workspaceStore = useWorkspaceStore()

const onReady = (event: DockviewReadyEvent) => {
  workspaceStore.init(event.api)

  workspaceStore.loadLayout().finally(() => {
    initialized.value = true
  })
}

useHead({
  title: "Highstate Designer",
})

defineOptions({
  components: {
    CustomTab,
    LayoutResetButton,
    GenericPanel,
  },
})
</script>

<template>
  <div :style="{ display: initialized ? 'block' : 'none' }">
    <DockviewVue
      class="dockview-container"
      :theme="themeDark"
      right-header-actions-component="LayoutResetButton"
      @ready="onReady"
    />
  </div>
</template>

<style scoped>
.dockview-container {
  width: 100%;
  height: 100vh;
}
</style>

<style>
@import "dockview-vue/dist/styles/dockview.css";
</style>
