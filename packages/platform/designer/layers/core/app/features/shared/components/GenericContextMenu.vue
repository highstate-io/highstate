<script setup lang="ts">
import InlineCopyButton from "./InlineCopyButton.vue"

const { title, subtitle } = defineProps<{
  title: string
  subtitle: string
}>()

const visible = defineModel<boolean>("visible", { default: false })
const menuX = ref(0)
const menuY = ref(0)

const contextMenu = useTemplateRef("contextMenu")

const showContextMenu = async (event: MouseEvent) => {
  event.preventDefault()
  visible.value = false
  menuX.value = event.clientX
  menuY.value = event.clientY

  await nextTick()
  visible.value = true
}

watch(
  visible,
  (isVisible, _, onCleanup) => {
    if (!isVisible) {
      return
    }

    const handleMouseEvent = (event: MouseEvent) => {
      const element = contextMenu.value?.$el as HTMLElement | undefined
      if (event.target instanceof Node && element?.contains(event.target)) {
        return
      }

      visible.value = false
    }

    window.addEventListener("mousedown", handleMouseEvent)
    onCleanup(() => window.removeEventListener("mousedown", handleMouseEvent))
  },
  { immediate: true, flush: "sync" },
)

onUnmounted(() => {
  visible.value = false
})

defineExpose({ showContextMenu })
</script>

<template>
  <VMenu v-model="visible" :target="[menuX, menuY]" location="end" :close-on-content-click="false">
    <VList ref="contextMenu" density="compact" variant="text" style="padding-bottom: 0">
      <slot name="header">
        <VListItem class="mb-2">
          <VListItemTitle>{{ title }}</VListItemTitle>
          <VListItemSubtitle class="d-flex align-center" style="font-family: monospace">
            {{ subtitle }}

            <InlineCopyButton :content="subtitle" />
          </VListItemSubtitle>
        </VListItem>
      </slot>

      <slot />
    </VList>
  </VMenu>
</template>
