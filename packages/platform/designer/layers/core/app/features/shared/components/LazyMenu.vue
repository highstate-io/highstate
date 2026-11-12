<script setup lang="ts">
import type { ComponentPublicInstance } from "vue"

defineOptions({ inheritAttrs: false })

const { disabled = false, openOnHover = false } = defineProps<{
  disabled?: boolean
  openOnHover?: boolean
}>()

const opened = defineModel<boolean>({ default: false })
const initialized = ref(false)
const activator = shallowRef<Element>()
const menu = useTemplateRef<{ activatorEl?: Element }>("menu")
const menuId = `hs-lazy-menu-${useId()}`
let pendingEvents: (MouseEvent | FocusEvent)[] | undefined
let pendingKey: string | undefined
let hasEntered = false

watch(
  opened,
  value => {
    if (value) {
      initialized.value = true
    } else {
      pendingKey = undefined
    }
  },
  { immediate: true, flush: "sync" },
)

const setActivator = (value: Element | ComponentPublicInstance | null) => {
  const element = value && "$el" in value ? value.$el : value
  activator.value = element instanceof Element ? element : undefined
}

const initializeFromEvent = (event: MouseEvent | FocusEvent | KeyboardEvent) => {
  if (disabled) {
    return
  }

  if (
    !hasEntered &&
    event instanceof KeyboardEvent &&
    ["ArrowDown", "ArrowUp"].includes(event.key)
  ) {
    event.preventDefault()
    event.stopImmediatePropagation()
    pendingKey = event.key
    initialized.value = true
    opened.value = true
    return
  }

  if (activator.value && menu.value?.activatorEl === activator.value) {
    return
  }

  const element = activator.value
  if (!element) {
    return
  }

  if (
    event instanceof KeyboardEvent ||
    !openOnHover ||
    (event.type === "focus" && !element.matches(":focus-visible"))
  ) {
    return
  }

  ;(pendingEvents ??= []).push(event)
  initialized.value = true
}

const handleAfterEnter = () => {
  hasEntered = true
  const key = pendingKey
  pendingKey = undefined
  const element = activator.value

  // the first lazy content must be visible before vuetify can find its focusable children
  if (
    key &&
    !disabled &&
    opened.value &&
    element?.isConnected &&
    document.activeElement === element
  ) {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }))
  }
}

// Delegate only after Vuetify has actually bound its external activator, not after an assumed number of ticks.
watch(
  () => menu.value?.activatorEl,
  element => {
    const events = pendingEvents
    pendingEvents = undefined

    if (disabled || !element || element !== activator.value || !element.isConnected) {
      return
    }

    for (const event of events ?? []) {
      if (event.type === "mouseenter") {
        if (element.matches(":hover")) {
          element.dispatchEvent(
            new MouseEvent("mouseenter", {
              clientX: (event as MouseEvent).clientX,
              clientY: (event as MouseEvent).clientY,
            }),
          )
        }
      } else if (event.type === "focus") {
        if (document.activeElement === element) {
          element.dispatchEvent(new FocusEvent("focus"))
        }
      }
    }
  },
  { flush: "post" },
)

onScopeDispose(() => {
  pendingEvents = undefined
  pendingKey = undefined
})

const activatorProps = computed(() => ({
  ref: setActivator,
  "aria-haspopup": "menu",
  "aria-expanded": String(opened.value),
  "aria-controls": menuId,
  "aria-owns": menuId,
  onKeydown: initializeFromEvent,
  ...(openOnHover ? { onMouseenter: initializeFromEvent, onFocus: initializeFromEvent } : {}),
}))
</script>

<template>
  <slot name="activator" :props="activatorProps" />
  <VMenu
    v-if="initialized"
    ref="menu"
    :id="menuId"
    v-model="opened"
    v-bind="$attrs"
    :activator="activator"
    :disabled="disabled"
    :open-on-hover="openOnHover"
    :open-on-click="false"
    @after-enter="handleAfterEnter"
  >
    <slot />
  </VMenu>
</template>
