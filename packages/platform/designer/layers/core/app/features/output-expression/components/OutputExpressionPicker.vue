<script setup lang="ts">
import type { OutputExpressionOption } from "#layers/core/app/features/output-expression"

const { options, x, y } = defineProps<{
  targetLabel: string
  rootType: string
  targetType: string
  options: OutputExpressionOption[]
  x: number
  y: number
}>()

const emit = defineEmits<{
  select: [path: string | undefined]
  close: []
}>()

type OutputExpressionTreeItem = OutputExpressionOption & {
  id: string
  children?: OutputExpressionTreeItem[]
}

const search = ref("")
const showAll = ref(false)
const opened = ref<string[]>(["__root__"])
const pickerEl = useTemplateRef("picker")

onClickOutside(pickerEl, () => emit("close"))

const optionMatchesSearch = (option: OutputExpressionOption, query: string) => {
  if (!query) {
    return true
  }

  return (
    option.label.toLowerCase().includes(query) ||
    option.title.toLowerCase().includes(query) ||
    option.type.toLowerCase().includes(query)
  )
}

const getParentPath = (path: string | undefined) => {
  if (!path) {
    return undefined
  }

  const index = path.lastIndexOf(".")
  if (index === -1) {
    return undefined
  }

  return path.slice(0, index)
}

const getAncestorIds = (path: string | undefined) => {
  const ancestors = ["__root__"]
  let current = getParentPath(path)

  while (current) {
    ancestors.push(current)
    current = getParentPath(current)
  }

  return ancestors
}

const treeItems = computed<OutputExpressionTreeItem[]>(() => {
  const items = new Map<string, OutputExpressionTreeItem>()

  for (const option of options) {
    const id = option.path ?? "__root__"
    items.set(id, { ...option, id, children: [] })
  }

  const roots: OutputExpressionTreeItem[] = []

  for (const item of items.values()) {
    const parentPath = getParentPath(item.path)
    const parent = items.get(parentPath ?? "__root__")

    if (item.id !== "__root__" && parent) {
      parent.children?.push(item)
      continue
    }

    roots.push(item)
  }

  return roots
})

const filterTreeItem = (
  item: OutputExpressionTreeItem,
  query: string,
): OutputExpressionTreeItem | null => {
  const children = item.children
    ?.map(child => filterTreeItem(child, query))
    .filter((child): child is OutputExpressionTreeItem => Boolean(child))

  const visibleByMode = showAll.value || item.assignable || (children?.length ?? 0) > 0
  const visibleBySearch = optionMatchesSearch(item, query) || (children?.length ?? 0) > 0

  if (!visibleByMode || !visibleBySearch) {
    return null
  }

  return { ...item, children: children && children.length > 0 ? children : undefined }
}

const filteredTreeItems = computed(() => {
  const query = search.value.trim().toLowerCase()

  return treeItems.value
    .map(item => filterTreeItem(item, query))
    .filter((item): item is OutputExpressionTreeItem => Boolean(item))
})

watchEffect(() => {
  if (search.value.trim().length > 0 || showAll.value) {
    return
  }

  opened.value = Array.from(
    new Set(options.filter(option => option.assignable).flatMap(option => getAncestorIds(option.path))),
  )
})
</script>

<template>
  <VCard
    ref="picker"
    class="output-expression-picker"
    :style="{
      left: `${Math.max(12, x)}px`,
      top: `${Math.max(12, y)}px`,
    }"
    elevation="10"
    width="420"
  >
    <VCardTitle class="d-flex align-center py-2 pr-2 text-subtitle-1">
      <span>Connect to {{ targetLabel }}</span>
      <VSpacer />
      <VBtn icon="mdi-close" size="small" variant="text" @click="emit('close')" />
    </VCardTitle>

    <VCardText class="pt-0 pb-2">
      <div class="text-caption text-medium-emphasis mb-2">{{ rootType }} -> {{ targetType }}</div>

      <VTextField
        v-model="search"
        density="compact"
        variant="outlined"
        prepend-inner-icon="mdi-magnify"
        placeholder="Search expressions..."
        hide-details
        autofocus
      />

      <div class="d-flex align-center mt-3 mb-1">
        <div class="text-caption text-medium-emphasis">
          {{ showAll ? "All expressions" : "Compatible" }}
        </div>
        <VSpacer />
        <VBtn size="x-small" variant="text" @click="showAll = !showAll">
          {{ showAll ? "Compatible only" : "Show all" }}
        </VBtn>
      </div>

      <div class="output-expression-picker__list">
        <VTreeview
          v-if="filteredTreeItems.length > 0"
          v-model:opened="opened"
          :items="filteredTreeItems"
          item-title="label"
          item-value="id"
          density="compact"
          :open-all="search.trim().length > 0"
          open-on-click
          indent-lines
        >
          <template #prepend="{ item }">
            <VIcon v-if="item.assignable" size="12">mdi-circle-outline</VIcon>
            <VIcon v-else size="12" color="disabled">mdi-circle-off-outline</VIcon>
          </template>

          <template #title="{ item }">
            <div
              class="output-expression-picker__item"
              :class="{ 'output-expression-picker__item--disabled': !item.assignable }"
              @click.stop="item.assignable && emit('select', item.path)"
            >
              <div class="text-body-2">
                {{ item.label }}{{ item.multiple ? "[]" : "" }}
              </div>
              <div class="text-caption text-medium-emphasis">
                {{ item.type }}
                <template v-if="!item.assignable"> · not assignable</template>
              </div>
            </div>
          </template>
        </VTreeview>

        <VList v-else density="compact">
          <VListItem>
            <VListItemTitle>No expressions found</VListItemTitle>
          </VListItem>
        </VList>
      </div>
    </VCardText>
  </VCard>
</template>

<style scoped>
.output-expression-picker {
  position: absolute;
  z-index: 10;
  pointer-events: auto;
}

.output-expression-picker__list {
  max-height: 280px;
  overflow: auto;
}

.output-expression-picker__item {
  cursor: pointer;
}

.output-expression-picker__item--disabled {
  cursor: default;
  opacity: 0.56;
}
</style>
