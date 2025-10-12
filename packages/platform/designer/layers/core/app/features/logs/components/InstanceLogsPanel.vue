<script setup lang="ts">
import type { Terminal } from "@xterm/xterm"
import { GenericTerminal } from "#layers/core/app/features/terminals"

const { operationId, stateId } = defineProps<{
  operationId: string
  stateId: string
}>()

const { projectStore } = useProjectStores()
const { $client } = useNuxtApp()

let terminal: Terminal | null = null

const writeLogEntry = (message: string) => {
  const lines = message.split("\n")
  for (const line of lines) {
    terminal!.writeln(line)
  }
}

// TODO: check operation status
const { unsubscribe } = $client.logs.watchInstanceLogs.subscribe(
  {
    operationId,
    stateId,
  },
  {
    onData: message => {
      if (!terminal) {
        return
      }

      writeLogEntry(message.content)
    },
  },
)

onUnmounted(unsubscribe)

// TODO: log entry deduplication and ordering

const onLoad = async (loadedTerminal: Terminal) => {
  terminal = loadedTerminal

  const logs = await $client.logs.getInstanceLogs.query({
    projectId: projectStore.projectId,
    stateId,
    operationId,
  })

  for (const log of logs) {
    writeLogEntry(log.content)
  }
}
</script>

<template>
  <GenericTerminal @load="onLoad" />
</template>
