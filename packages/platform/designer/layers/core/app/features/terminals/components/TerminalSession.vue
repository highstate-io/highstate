<script setup lang="ts">
import type { Terminal } from "@xterm/xterm"
import FullScreenTerminal from "./GenericTerminal.vue"
import { useTerminalSession } from "../business"

const { sessionId } = defineProps<{
  sessionId: string
}>()

const { projectStore } = useProjectStores()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

const { initialize } = useTerminalSession(projectStore.projectId, sessionId)

const onLoad = (terminal: Terminal) => {
  initialize(terminal)
}
</script>

<template>
  <FullScreenTerminal @load="onLoad" />
</template>
