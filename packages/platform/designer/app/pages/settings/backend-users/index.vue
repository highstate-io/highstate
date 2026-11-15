<script setup lang="ts">
import UsersPage from "#layers/core/app/features/settings/components/UsersPage.vue"

definePageMeta({
  name: "settings.backend-users",
  tab: {
    label: "Backend Users",
    group: "Security",
    icon: "mdi-account-group",
    order: 6,
    subpages: ["settings.backend-user-details"],
  },
})
</script>

<template
  ><UsersPage /></template
>
