<script setup lang="ts">
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebglAddon } from "@xterm/addon-webgl"

const terminalEl = useTemplateRef("terminalEl")

const { columns, rows, content } = defineProps<{
  columns?: number
  rows?: number
  content?: string
}>()

const needAutoResize = !columns || !rows

const emit = defineEmits<{
  load: [terminal: Terminal]
}>()

let terminal: Terminal | null = null

onMounted(() => {
  terminal = new Terminal({ fontFamily: "monospace" })
  const fitAddon = new FitAddon()
  const webglAddon = new WebglAddon()

  if (needAutoResize) {
    terminal.loadAddon(fitAddon)
  } else {
    terminal.resize(columns, rows)
  }

  terminal.loadAddon(webglAddon)

  terminal.open(terminalEl.value!)

  if (needAutoResize) {
    fitAddon.fit()

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
    })

    resizeObserver.observe(terminalEl.value!)

    onUnmounted(() => {
      resizeObserver.disconnect()
    })
  }

  emit("load", terminal)

  if (content !== undefined) {
    watch(
      computed(() => content),
      newContent => {
        if (!terminal) return

        terminal.clear()
        terminal.write(newContent.replace(/\n/g, "\r\n"))
      },
      { immediate: true },
    )
  }

  onUnmounted(() => {
    terminal?.dispose()
  })
})
</script>

<template>
  <div ref="terminalEl" class="terminal-container" />
</template>

<style scoped>
.terminal-container {
  width: 100%;
  height: 100%;
  padding: 5px 10px;
  background-color: black;
}
</style>

<style>
@import "@xterm/xterm/css/xterm.css";
</style>
