<script setup lang="ts">
import UserDetailsPage from "#layers/core/app/features/settings/components/UserDetailsPage.vue"

const { params } = defineProps<{ params: { userId: string } }>()
definePageMeta({ name: "settings.backend-user-details" })
</script>

<template
  ><UserDetailsPage :key="params.userId" :user-id="params.userId" /></template
>
