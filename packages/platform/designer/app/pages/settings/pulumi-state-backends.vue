<script setup lang="ts">
import { RuntimeSettingsPage } from "#layers/core/app/features/settings"

definePageMeta({
  name: "settings.pulumi-state-backends",
  tab: { label: "Pulumi State Backends", icon: "mdi-database", order: 4, group: "Runtime" },
})
</script>

<template>
  <RuntimeSettingsPage
    kind="pulumi-state-backend"
    title="Pulumi State Backends"
    icon="mdi-database"
    description="Configure Pulumi state storage independently of container execution."
  />
</template>
