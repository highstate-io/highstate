<script setup lang="ts">
import UsersPage from "#layers/core/app/features/settings/components/UsersPage.vue"

const { params } = defineProps<{ params: { projectId: string } }>()
definePageMeta({
  name: "settings.users",
  tab: {
    label: "Users",
    icon: "mdi-account-group",
    order: 20,
    subpages: ["settings.user-details"],
  },
})
</script>

<template
  ><UsersPage :key="params.projectId" :project-id="params.projectId" /></template
>
