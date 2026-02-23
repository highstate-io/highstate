<script setup lang="ts">
import type { EntityModel } from "@highstate/contract"

import { ComponentIcon } from "#layers/core/app/features/shared"
import { onHighstateActionInvoked } from "#layers/core/app/utils/monaco"

import type { OutputReferencedEntitySnapshot } from "../business"

type LoadFn = () => Promise<OutputReferencedEntitySnapshot[]>

type ActivatorSlotProps = {
  props: Record<string, unknown>
  opened: boolean
}

defineSlots<{
  activator: (props: ActivatorSlotProps) => unknown
  content: (props: { entity: OutputReferencedEntitySnapshot }) => unknown
}>()

const { canLoad, cacheKey, entities, load } = defineProps<{
  canLoad: boolean
  cacheKey: string
  entities: Record<string, EntityModel | undefined>
  load: LoadFn
}>()

const panelOpened = ref(false)
const loading = ref(false)
const loaded = ref(false)
const loadError = ref<string | null>(null)
const referencedEntities = ref<OutputReferencedEntitySnapshot[]>([])

const contentEl = useTemplateRef<HTMLElement>("content")

const tab = ref<string | null>(null)

const getErrorMessage = (error: unknown): string => {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message.length > 0) {
      return message
    }
  }

  if (typeof error === "string" && error.length > 0) {
    return error
  }

  try {
    return JSON.stringify(error)
  } catch {
    return "Unknown error"
  }
}

const reset = () => {
  loading.value = false
  loaded.value = false
  loadError.value = null
  referencedEntities.value = []
  tab.value = null
}

watch(
  () => cacheKey,
  () => {
    reset()
  },
)

async function ensureLoaded() {
  if (!canLoad || loading.value || loaded.value) {
    return
  }

  loadError.value = null
  loading.value = true
  try {
    referencedEntities.value = await load()

    loaded.value = true

    if (!tab.value && referencedEntities.value.length > 0) {
      tab.value = referencedEntities.value[0]!.snapshotId
    }
  } catch (error) {
    loadError.value = getErrorMessage(error)
  } finally {
    loading.value = false
  }
}

watch(panelOpened, opened => {
  if (opened) {
    void ensureLoaded()
  } else {
    reset()
  }
})

const handleActivatorContextMenu = (event: MouseEvent) => {
  if (!canLoad) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  panelOpened.value = true
}

const handleGlobalContextMenu = (event: MouseEvent) => {
  if (!panelOpened.value) {
    return
  }

  const path = event.composedPath()
  if (contentEl.value && path.includes(contentEl.value)) {
    return
  }

  const target = event.target
  if (!(target instanceof Node)) {
    panelOpened.value = false
    return
  }

  panelOpened.value = false
}

onMounted(() => {
  window.addEventListener("contextmenu", handleGlobalContextMenu, { capture: true })
})

onBeforeUnmount(() => {
  window.removeEventListener("contextmenu", handleGlobalContextMenu, { capture: true })
})

const unsubscribeAction = onHighstateActionInvoked(action => {
  if (action.kind === "openEntitySnapshot") {
    panelOpened.value = false
  }
})

onBeforeUnmount(() => {
  unsubscribeAction()
})

const getEntityMeta = (entityType: string) => {
  return entities[entityType]?.meta
}

type EntityUiMeta = {
  title?: string
  icon?: string
  iconColor?: string
  secondaryIcon?: string
  secondaryIconColor?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const getEntityOverrideMeta = (entity: OutputReferencedEntitySnapshot): EntityUiMeta => {
  if (!isRecord(entity.content)) {
    return {}
  }

  const meta = entity.content.$meta
  if (!isRecord(meta)) {
    return {}
  }

  return {
    ...(typeof meta.title === "string" ? { title: meta.title } : {}),
    ...(typeof meta.icon === "string" ? { icon: meta.icon } : {}),
    ...(typeof meta.iconColor === "string" ? { iconColor: meta.iconColor } : {}),
    ...(typeof meta.secondaryIcon === "string" ? { secondaryIcon: meta.secondaryIcon } : {}),
    ...(typeof meta.secondaryIconColor === "string"
      ? { secondaryIconColor: meta.secondaryIconColor }
      : {}),
  }
}

const getEntityDisplay = (entity: OutputReferencedEntitySnapshot) => {
  const modelMeta = getEntityMeta(entity.entityType)
  const overrideMeta = getEntityOverrideMeta(entity)

  return {
    title: modelMeta?.title ?? entity.entityType,
    subtitle: overrideMeta.title,
    metaForIcon: overrideMeta.icon ? overrideMeta : modelMeta,
  }
}
</script>

<template>
  <VMenu
    v-model="panelOpened"
    :open-on-click="false"
    :close-on-content-click="false"
    location="end"
    :disabled="!canLoad"
  >
    <template #activator="{ props: menuProps }">
      <slot
        name="activator"
        :props="{ ...menuProps, onContextmenu: handleActivatorContextMenu }"
        :opened="panelOpened"
      />
    </template>

    <VSheet
      ref="content"
      color="black"
      class="hs-output-popup d-flex"
      :style="{
        width: '800px',
        height: '480px',
      }"
    >
      <div
        v-if="!canLoad"
        class="d-flex flex-column justify-center"
        :style="{ width: '240px', height: '100%' }"
      >
        <div class="pa-3">
          <div class="text-medium-emphasis">Unavailable</div>
          <div class="text-medium-emphasis">Missing project/state context</div>
        </div>
      </div>

      <div
        v-else-if="loadError"
        class="d-flex flex-column justify-center"
        :style="{ width: '100%', height: '100%' }"
      >
        <div class="pa-3" :style="{ maxWidth: '720px' }">
          <div class="text-medium-emphasis">Failed to load referenced entities</div>
          <VAlert type="error" density="compact" class="mt-2">
            {{ loadError }}
          </VAlert>
        </div>
      </div>

      <div
        v-else-if="loaded && referencedEntities.length === 0"
        class="d-flex flex-column justify-center"
        :style="{ width: '240px', height: '100%' }"
      >
        <div class="pa-3">
          <div class="text-medium-emphasis">No referenced entities</div>
        </div>
      </div>

      <template v-else>
        <div
          class="d-flex flex-column"
          :style="{ width: '240px', height: '100%', overflow: 'auto' }"
        >
          <VTabs v-model="tab" color="primary" direction="vertical">
            <VTab
              v-for="entity in referencedEntities"
              :key="entity.snapshotId"
              :value="entity.snapshotId"
              class="justify-start"
            >
              <div
                class="d-flex flex-column"
                :style="{ gap: '2px', minWidth: 0, width: '100%', alignItems: 'flex-start' }"
              >
                <div
                  class="d-flex"
                  :style="{ gap: '8px', minWidth: 0, width: '100%', alignItems: 'center' }"
                >
                  <div v-if="getEntityDisplay(entity).metaForIcon" class="d-flex">
                    <ComponentIcon :meta="getEntityDisplay(entity).metaForIcon!" :size="24" />
                  </div>

                  <div
                    class="d-flex flex-column"
                    :style="{ gap: '2px', minWidth: 0, width: '100%', alignItems: 'flex-start' }"
                  >
                    <span class="text-truncate" :style="{ maxWidth: '220px' }">
                      {{ getEntityDisplay(entity).title }}
                    </span>

                    <div
                      v-if="getEntityDisplay(entity).subtitle"
                      class="text-caption text-medium-emphasis text-truncate"
                      :style="{
                        maxWidth: '220px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }"
                    >
                      {{ getEntityDisplay(entity).subtitle }}
                    </div>
                  </div>
                </div>
              </div>
            </VTab>
          </VTabs>
        </div>

        <VDivider vertical />

        <div class="d-flex flex-column" :style="{ flex: 1, minWidth: 0 }">
          <VTabsWindow v-model="tab" :style="{ flex: 1, minWidth: 0 }">
            <VTabsWindowItem
              v-for="entity in referencedEntities"
              :key="entity.snapshotId"
              :value="entity.snapshotId"
            >
              <div class="d-flex flex-column" :style="{ height: '480px' }">
                <div class="flex-grow-1" :style="{ minHeight: 0 }">
                  <slot name="content" :entity="entity" />
                </div>
              </div>
            </VTabsWindowItem>
          </VTabsWindow>
        </div>
      </template>
    </VSheet>
  </VMenu>
</template>
