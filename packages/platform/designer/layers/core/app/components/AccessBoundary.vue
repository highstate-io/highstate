<script setup lang="ts">
import type { AccessRequirement } from "../utils/access-control"
import { accessError } from "../utils/access-control"

const {
  requirements = [],
  title,
  panel = false,
} = defineProps<{
  requirements?: AccessRequirement[]
  title?: string
  panel?: boolean
}>()

const access = useAccess()
const status = computed(() => access.status(requirements))
const failure = ref<string>()

onErrorCaptured(error => {
  const denial = accessError(error)
  if (!denial) {
    return
  }

  failure.value = denial.message
  return false
})

watch(
  () => access.revision.value,
  () => {
    failure.value = undefined
  },
)
</script>

<template>
  <AccessNotice v-if="failure" :message="failure" :title="title" :panel="panel" />
  <div
    v-else-if="status.pending"
    role="status"
    class="pa-6"
    :class="{ 'd-flex align-center justify-center h-100': panel }"
  >
    Checking access…
  </div>
  <AccessNotice
    v-else-if="!status.allowed"
    :message="status.reason"
    :title="title"
    :panel="panel"
  />
  <slot v-else />
</template>
