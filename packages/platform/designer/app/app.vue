<script setup lang="ts">
import { themeDark } from "dockview-core"
import { type DockviewReadyEvent, DockviewVue } from "dockview-vue"
import { GlobalSearchCommandPalette } from "#layers/core/app/features/global-search"
import { LayoutResetButton } from "#layers/core/app/features/main-menu"
import { CustomTab, GenericPanel } from "#layers/core/app/features/shared"

const initialized = ref(false)
const workspaceStore = useWorkspaceStore()
const access = useAccess()

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
  <div v-if="access.rejection.value" class="access-rejection-banner">
    <AccessNotice
      fallback
      :title="access.rejection.value.unauthorized ? 'Sign-in required' : 'Access denied'"
      :message="`${access.rejection.value.message} (${access.rejection.value.path})`"
    />
  </div>
  <a href="/login" style="position: fixed; bottom: 0.5rem; right: 0.5rem; z-index: 1000">Account</a>
  <div v-if="access.authenticated.value" :style="{ display: initialized ? 'block' : 'none' }">
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
.access-rejection-banner {
  position: fixed;
  right: 20px;
  bottom: 36px;
  z-index: 3000;
  max-width: 520px;
  background: #202024;
}
</style>
