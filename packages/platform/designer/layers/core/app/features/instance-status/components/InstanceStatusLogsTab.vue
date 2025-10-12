<script setup lang="ts">
import {
  isTransientInstanceOperationStatus,
  type InstanceOperationState,
} from "@highstate/backend/shared"
import type { Terminal } from "@xterm/xterm"
import { GenericTerminal } from "#layers/core/app/features/terminals"

const { operationState } = defineProps<{
  operationState: InstanceOperationState
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

// only subscribe to logs if the status is transient and more logs be streamed
if (isTransientInstanceOperationStatus(operationState.status)) {
  const { unsubscribe } = $client.logs.watchInstanceLogs.subscribe(
    {
      stateId: operationState.stateId,
      operationId: operationState.operationId,
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
}

// TODO: log entry deduplication and ordering

const onLoad = async (loadedTerminal: Terminal) => {
  terminal = loadedTerminal

  const logs = await $client.logs.getInstanceLogs.query({
    projectId: projectStore.projectId,
    stateId: operationState.stateId,
    operationId: operationState.operationId,
  })

  for (const log of logs) {
    writeLogEntry(log.content)
  }
}
</script>

<template>
  <GenericTerminal class="mt-2 mb-2" :columns="80" :rows="24" @load="onLoad" />
</template>
