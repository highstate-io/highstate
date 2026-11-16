<script setup lang="ts">
import { RuntimeSettingsPage } from "#layers/core/app/features/settings"

definePageMeta({
  name: "settings.container-registry-credentials",
  tab: { label: "OCI Registry Credentials", icon: "mdi-docker", order: 6, group: "Runtime" },
})
</script>

<template>
  <RuntimeSettingsPage
    kind="container-registry-credential"
    title="OCI Registry Credentials"
    icon="mdi-docker"
    description="Manage credentials for container image registries."
  />
</template>
