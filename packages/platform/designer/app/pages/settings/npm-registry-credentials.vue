<script setup lang="ts">
import { RuntimeSettingsPage } from "#layers/core/app/features/settings"

definePageMeta({
  name: "settings.npm-registry-credentials",
  tab: { label: "npm Registry Credentials", icon: "mdi-npm", order: 5, group: "Runtime" },
})
</script>

<template>
  <RuntimeSettingsPage
    kind="npm-registry-credential"
    title="npm Registry Credentials"
    icon="mdi-npm"
    description="Manage credentials for project library package registries."
  />
</template>
