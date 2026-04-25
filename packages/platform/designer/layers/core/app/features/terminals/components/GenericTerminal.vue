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
let fitAddon: FitAddon | null = null

function fitTerminal() {
  if (!needAutoResize || !fitAddon || !terminalEl.value) {
    return
  }

  const { clientWidth, clientHeight } = terminalEl.value
  if (clientWidth <= 0 || clientHeight <= 0) {
    return
  }

  fitAddon.fit()
}

onMounted(() => {
  terminal = new Terminal({ fontFamily: "monospace" })
  fitAddon = new FitAddon()
  const webglAddon = new WebglAddon()

  if (needAutoResize) {
    terminal.loadAddon(fitAddon)
  } else {
    terminal.resize(columns, rows)
  }

  terminal.loadAddon(webglAddon)

  terminal.open(terminalEl.value!)

  if (needAutoResize) {
    fitTerminal()

    const resizeObserver = new ResizeObserver(() => {
      fitTerminal()
    })

    resizeObserver.observe(terminalEl.value!)

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void nextTick(() => fitTerminal())
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    onUnmounted(() => {
      resizeObserver.disconnect()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
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

onActivated(() => {
  void nextTick(() => fitTerminal())
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
