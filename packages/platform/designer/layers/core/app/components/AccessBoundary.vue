<script setup lang="ts">
import type { AccessRequirement } from "../utils/access-control"
import { accessError } from "../utils/access-control"

const { requirements = [], title } = defineProps<{
  requirements?: AccessRequirement[]
  title?: string
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
  <AccessNotice v-if="failure" :message="failure" :title="title" />
  <div v-else-if="status.pending" role="status" class="pa-6">Checking access…</div>
  <AccessNotice v-else-if="!status.allowed" :message="status.reason" :title="title" />
  <slot v-else />
</template>
