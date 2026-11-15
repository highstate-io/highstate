<script setup lang="ts">
import type { TerminalSessionOutput } from "@highstate/backend/shared"
import { ContextMenuItem } from "#layers/core/app/features/shared"

const { stateId, terminalIds } = defineProps<{
  stateId: string
  terminalIds: string[]
}>()

const { instancesStore, stateStore } = useProjectStores()

const {
  state: terminals,
  execute: loadTerminals,
  isLoading: isTerminalsLoading,
} = stateStore.getTerminalsState(computed(() => terminalIds))

const {
  state: sessions,
  execute: loadSessions,
  isLoading: isSessionsLoading,
} = instancesStore.getTerminalSessionsState(computed(() => stateId))

const visible = defineModel<boolean>("visible")

watch(visible, newValue => {
  if (newValue) {
    loadSessions()
    loadTerminals()
  }
})

const getSessionSubtitle = (session: TerminalSessionOutput) => {
  if (session.finishedAt) {
    return `Finished at ${new Date(session.finishedAt).toLocaleString()}`
  }

  return `Started at ${new Date(session.startedAt!).toLocaleString()}`
}

const getSessionColor = (session: TerminalSessionOutput) => {
  const theme = useTheme()

  if (session.finishedAt) {
    return "#9E9E9E"
  }

  return theme.current.value.colors.success
}

const loadingTerminalId = ref<string | null>(null)

const openTerminal = async (terminalId: string) => {
  loadingTerminalId.value = terminalId

  try {
    await instancesStore.openTerminal(terminalId, true)
  } finally {
    loadingTerminalId.value = null
  }
}
</script>

<template>
  <ContextMenuItem icon="mdi-console" title="Terminals">
    <VMenu
      v-model="visible"
      :open-on-focus="false"
      open-on-hover
      :close-on-content-click="false"
      submenu
      activator="parent"
    >
      <VList density="compact" variant="text">
        <VListSubheader class="text-overline">Available Terminals</VListSubheader>

        <ContextMenuItem
          v-for="terminal in terminals"
          :key="terminal.id"
          :disabled="!!loadingTerminalId"
          :title="terminal.meta.title"
          :subtitle="terminal.meta.description"
          :custom-icon="terminal.meta.icon"
          :loading="loadingTerminalId === terminal.id"
          icon="mdi-console"
          @click="openTerminal(terminal.id)"
        />

        <VDivider class="mt-2 mb-2" />

        <VListSubheader class="text-overline">Sessions</VListSubheader>

        <div class="session-list-cointainer">
          <ContextMenuItem
            v-for="session in sessions"
            :key="session.id"
            :title="session.meta.title"
            :subtitle="getSessionSubtitle(session)"
            :custom-icon="session.meta.icon"
            icon="mdi-console"
            :color="getSessionColor(session)"
            @click="instancesStore.openTerminalSession(session)"
          />
        </div>

        <VListSubheader v-if="sessions.length === 0" class="text-disabled">
          No sessions found
        </VListSubheader>
      </VList>
    </VMenu>

    <template #append>
      <VIcon icon="mdi-menu-right" size="x-small" />
    </template>
  </ContextMenuItem>
</template>

<style scoped>
.session-list-cointainer {
  max-height: 300px;
  overflow-y: auto;
}
</style>
