<script setup lang="ts">
definePageMeta({
  name: "settings.about",
  tab: {
    label: "About",
    icon: "mdi-information",
    order: 99, // show last
  },
})
</script>

<template>
  <!-- Header Section -->
  <div class="d-flex align-center justify-space-between">
    <div>
      <h2 class="text-h5 font-weight-medium mb-1">About Highstate Designer</h2>
      <p class="text-body-2 text-medium-emphasis ma-0">
        A powerful infrastructure-as-code management tool that helps you design, deploy, and manage
        cloud infrastructure with ease.
      </p>
    </div>
  </div>

  <VDivider class="mt-6 mb-6" />

  <!-- Content Section -->
  <div class="d-flex justify-space-between mb-2">
    <span>Version:</span>
    <span class="font-weight-medium">{{ $config.public.version }}</span>
  </div>
</template>
