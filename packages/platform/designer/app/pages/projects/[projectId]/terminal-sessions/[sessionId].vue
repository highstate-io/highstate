<script setup lang="ts">
import { TerminalSession } from "#layers/core/app/features/terminals"
import { ProjectContainer } from "#layers/core/app/features/shared"

definePageMeta({
  name: "terminal-session",
  panelId: route =>
    `projects/${route.params.projectId}/terminal-sessions/${route.params.sessionId}`,

  panel: async route => {
    const { $client } = useNuxtApp()

    const session = await $client.terminal.getTerminalSession.query({
      projectId: route.params.projectId as string,
      sessionId: route.params.sessionId as string,
    })

    if (session) {
      return {
        title: session.meta.globalTitle ?? session.meta.title,
        customIcon: session.meta.icon,
        icon: "mdi-console",
        closable: true,
      }
    }

    return {
      title: `Terminal: ${route.params.sessionId}`,
      icon: "mdi-console",
      closable: true,
    }
  },
})

const { params } = defineProps<{
  params: {
    projectId: string
    sessionId: string
  }
}>()

ensureProjectStoresCreated(params.projectId)
</script>

<template>
  <ProjectContainer :project-id="params.projectId" can-unlock>
    <TerminalSession :session-id="params.sessionId" />
  </ProjectContainer>
</template>
