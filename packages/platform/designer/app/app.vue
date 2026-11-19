<script setup lang="ts">
import { themeDark } from "dockview-core"
import { type DockviewReadyEvent, DockviewVue } from "dockview-vue"
import { GlobalSearchCommandPalette } from "#layers/core/app/features/global-search"
import { CustomTab, GenericPanel } from "#layers/core/app/features/shared"
import WorkspaceHeaderActions from "./components/WorkspaceHeaderActions.vue"

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
    GenericPanel,
    WorkspaceHeaderActions,
  },
})
</script>

<template>
  <div v-if="!access.authenticated.value" class="session-expired-panel">
    <AccessNotice
      panel
      fallback
      title="Sign-in required"
      message="Your session has expired. Sign in again to continue."
    />
  </div>
  <div v-else-if="access.rejection.value" class="access-rejection-banner">
    <AccessNotice
      fallback
      :title="access.rejection.value.unauthorized ? 'Sign-in required' : 'Access denied'"
      :message="`${access.rejection.value.message} (${access.rejection.value.path})`"
    />
  </div>
  <div v-if="access.authenticated.value" :style="{ display: initialized ? 'block' : 'none' }">
    <DockviewVue
      class="dockview-container"
      :theme="themeDark"
      right-header-actions-component="WorkspaceHeaderActions"
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
.session-expired-panel {
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
