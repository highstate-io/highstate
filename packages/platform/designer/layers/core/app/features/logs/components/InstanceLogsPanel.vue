<script setup lang="ts">
import type { Terminal } from "@xterm/xterm"
import { GenericTerminal } from "#layers/core/app/features/terminals"
import { accessError } from "../../../utils/access-control"

const { operationId, stateId } = defineProps<{
  operationId: string
  stateId: string
}>()

const { projectStore } = useProjectStores()
const { $client } = useNuxtApp()

let terminal: Terminal | null = null
const failure = ref<string>()
const fail = (error: unknown) => {
  terminal?.reset()
  failure.value = accessError(error)?.message ?? "Logs could not be loaded."
}

const writeLogEntry = (message: string) => {
  const lines = message.split("\n")

  for (const line of lines) {
    terminal!.writeln(line)
  }
}

// TODO: check operation status
const { unsubscribe } = $client.logs.watchInstanceLogs.subscribe(
  {
    projectId: projectStore.projectId,
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
    onError: fail,
  },
)

onUnmounted(unsubscribe)

// TODO: log entry deduplication and ordering

const onLoad = async (loadedTerminal: Terminal) => {
  terminal = loadedTerminal

  try {
    const logs = await loadAllCollectionItems(query =>
      $client.logs.getInstanceLogs.query({
        projectId: projectStore.projectId,
        stateId,
        operationId,
        ...query,
      }),
    )

    for (const log of logs) {
      writeLogEntry(log.content)
    }
  } catch (error) {
    fail(error)
  }
}
</script>

<template>
  <AccessNotice v-if="failure" panel :message="failure" title="Logs unavailable" />
  <GenericTerminal v-else @load="onLoad" />
</template>
