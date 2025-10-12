<script setup lang="ts">
const { text, value } = defineProps<{
  text: string
  value: number
}>()

const { instancesStore } = useProjectStores()

const fullText = computed(() => {
  if (value === -1) {
    return text
  }

  return `${text} ${value}/${instancesStore.totalInstanceCount}...`
})
</script>

<template>
  <VCard v-if="text" variant="tonal">
    <VCardText class="text-overline">{{ fullText }}</VCardText>
    <VProgressLinear
      :indeterminate="value === -1"
      :model-value="value"
      :max="instancesStore.totalInstanceCount"
      :height="4"
      color="primary"
      class="w-full"
    />
  </VCard>
</template>
