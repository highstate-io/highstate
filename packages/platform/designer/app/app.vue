<script setup lang="ts">
import { themeDark } from "dockview-core"
import { type DockviewReadyEvent, DockviewVue } from "dockview-vue"
import { GlobalSearchCommandPalette } from "#layers/core/app/features/global-search"
import { LayoutResetButton } from "#layers/core/app/features/main-menu"
import { CustomTab, GenericPanel } from "#layers/core/app/features/shared"

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
  <a href="/login" style="position: fixed; bottom: 0.5rem; right: 0.5rem; z-index: 1000">Account</a>
  <div :style="{ display: initialized ? 'block' : 'none' }">
    <DockviewVue
      class="dockview-container"
      :theme="themeDark"
      right-header-actions-component="LayoutResetButton"
      @ready="onReady"
    />

    <GlobalSearchCommandPalette />
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
