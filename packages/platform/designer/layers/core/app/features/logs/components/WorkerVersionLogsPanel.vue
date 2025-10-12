<script setup lang="ts">
import type { Terminal } from "@xterm/xterm"
import { GenericTerminal } from "#layers/core/app/features/terminals"
import { decodeTime } from "ulid"

const { projectId, workerVersionId } = defineProps<{
  projectId: string
  workerVersionId: string
}>()

const { $client } = useNuxtApp()

let terminal: Terminal | null = null

const formatTimestamp = (ulidId: string): string => {
  try {
    const timestamp = decodeTime(ulidId)
    const date = new Date(timestamp)
    
    // format as HH:MM:SS.mmm
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const seconds = date.getSeconds().toString().padStart(2, '0')
    const millis = date.getMilliseconds().toString().padStart(3, '0')
    
    return `${hours}:${minutes}:${seconds}.${millis}`
  } catch {
    return "00:00:00.000"
  }
}

const writeLogEntry = (logId: string, content: string, isSystem: boolean = false) => {
  if (!terminal) return
  
  const timestamp = formatTimestamp(logId)
  
  // write timestamp in cyan
  terminal.write(`\x1b[36m[${timestamp}]\x1b[0m `)
  
  // write system prefix in bold magenta if it's a system log
  if (isSystem) {
    terminal.write(`\x1b[1;35m[runtime]\x1b[0m `)
  }
  
  // write the content
  terminal.writeln(content)
}

const { unsubscribe } = $client.logs.watchWorkerVersionLogs.subscribe(
  {
    projectId,
    workerVersionId,
  },
  {
    onData: message => {
      if (!terminal) {
        return
      }

      writeLogEntry(message.id, message.content, message.isSystem)
    },
  },
)

onUnmounted(unsubscribe)

const onLoad = async (loadedTerminal: Terminal) => {
  terminal = loadedTerminal

  const logs = await $client.logs.getWorkerVersionLogs.query({
    projectId,
    workerVersionId,
  })

  for (const log of logs) {
    writeLogEntry(log.id, log.content, log.isSystem)
  }
}
</script>

<template>
  <GenericTerminal @load="onLoad" />
</template>