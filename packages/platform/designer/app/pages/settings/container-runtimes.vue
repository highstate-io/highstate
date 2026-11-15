<script setup lang="ts">
import { RuntimeSettingsPage } from "#layers/core/app/features/settings"

definePageMeta({
  name: "settings.container-runtimes",
  tab: { label: "Container Runtimes", icon: "mdi-server-network", order: 3, group: "Runtime" },
})
</script>

<template>
  <RuntimeSettingsPage
    kind="container-runtime"
    title="Container Runtimes"
    icon="mdi-server-network"
    description="Configure Docker and Kubernetes container execution."
  />
</template>
