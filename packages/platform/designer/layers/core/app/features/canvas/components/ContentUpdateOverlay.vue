<script setup lang="ts">
defineProps<{
  visible: boolean
  text: string
}>()
</script>

<template>
  <VOverlay :model-value="visible" class="align-center justify-center" persistent contained>
    <VCard>
      <VCardText class="text-overline">{{ text }}</VCardText>
      <VProgressLinear indeterminate :height="4" color="primary" class="w-full" />
    </VCard>
  </VOverlay>
</template>
