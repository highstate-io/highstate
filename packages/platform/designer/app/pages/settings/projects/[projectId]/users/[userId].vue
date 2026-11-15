<script setup lang="ts">
import UserDetailsPage from "#layers/core/app/features/settings/components/UserDetailsPage.vue"

const { params } = defineProps<{ params: { projectId: string; userId: string } }>()
definePageMeta({ name: "settings.user-details" })
</script>

<template
  ><UserDetailsPage
    :key="`${params.projectId}/${params.userId}`"
    :project-id="params.projectId"
    :user-id="params.userId"
  /></template
>
