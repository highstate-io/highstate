<script setup lang="ts">
import { NewProjectDialog } from "#layers/core/app/features/main-menu"

defineProps<{
  params: unknown
}>()

definePageMeta({
  name: "home",
  panel: {
    title: "Projects",
    icon: "mdi-folder-multiple",
    closable: false,
  },
})

const projectsStore = useProjectsStore()
const workspaceStore = useWorkspaceStore()
const config = useRuntimeConfig()

const dialogVisible = ref(false)

// Hira's catchphrases
const catchphrases = [
  "Let's orchestrate this beautifully!",
  "State is everything!",
  "No infrastructure left behind!",
  "Visual first, code second!",
  "Infrastructure should be as elegant as it is functional!",
  "Time to sync the state!",
  "Ready to deploy some magic?",
  "Every good system starts with a solid foundation!",
  "Building the future, one container at a time!",
  "Kubernetes makes everything better... except debugging!",
  "Your infrastructure deserves some love too!",
  "Who needs sleep when you have perfectly orchestrated deployments?",
  "Configuration drift is my arch-nemesis!",
  "Monitoring dashboards are my happy place!",
  "Clean architecture is the key to digital zen!",
  "Infrastructure as art, code as poetry!",
  "Scaling up? Scaling out? Let's scale with style!",
  "Error 404: Downtime not found!",
  "Highstate слабее ArgoCD и FluxCD, но в цирке не выступает!",
]

// Select a random catchphrase that changes every 10 seconds
const currentCatchphrase = ref("")

const getRandomCatchphrase = () => {
  const randomIndex = Math.floor(Math.random() * catchphrases.length)
  return catchphrases[randomIndex]
}

// Initialize with a random catchphrase
currentCatchphrase.value = getRandomCatchphrase()

// Change catchphrase every 10 seconds
let catchphraseInterval: ReturnType<typeof setInterval>

onMounted(() => {
  catchphraseInterval = setInterval(() => {
    currentCatchphrase.value = getRandomCatchphrase()
  }, 10000) // 10 seconds
})

onUnmounted(() => {
  if (catchphraseInterval) {
    clearInterval(catchphraseInterval)
  }
})
</script>

<template>
  <div class="main-menu-container">
    <div class="content-layout">
      <VCard variant="text" class="project-card-inner">
        <VCardText>
          <VCardTitle class="text-center text-uppercase text-bold">Highstate Designer</VCardTitle>
          <VCardSubtitle class="text-center">
            v{{ config.public.version }} • Все зонды удалены
          </VCardSubtitle>

          <VDivider class="mt-4" />

          <VList variant="flat" class="main-menu-list">
            <VListItem
              class="list-item list-button"
              @click="workspaceStore.openDataSettingsPanel()"
            >
              <VIcon class="mr-2">mdi-database-cog</VIcon>
              Data & Settings
            </VListItem>

            <VListSubheader class="text-uppercase">Projects</VListSubheader>
            <div class="project-list">
              <VListItem
                v-for="project in projectsStore.projects"
                :key="project.id"
                class="list-item"
                @click="workspaceStore.openProjectPanel(project.id)"
              >
                <VIcon class="mr-2">mdi-folder</VIcon>
                {{ project.meta.title }}
              </VListItem>
            </div>

            <VListItem class="list-item" @click="dialogVisible = true">
              <VIcon class="mr-2">mdi-plus</VIcon>
              Create new project
            </VListItem>
          </VList>
        </VCardText>
      </VCard>

      <div class="mascot-container">
        <img
          src="../assets/hira-1.png"
          alt="Hira Nakamura - Highstate Mascot"
          class="mascot-image"
        />
        <div class="catchphrase-text text-h6">"{{ currentCatchphrase }}"</div>
      </div>
    </div>
  </div>

  <NewProjectDialog v-model:visible="dialogVisible" />
</template>

<style scoped>
.main-menu-container {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
}

.content-layout {
  display: flex;
  align-items: center;
}

.project-card {
  flex: 1;
  display: flex;
  justify-content: center;
  margin-right: 0;
}

.mascot-container {
  flex-shrink: 0;
  width: calc(min(400px, 30vw));
  padding-left: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.mascot-image {
  width: calc(min(400px, 30vw));
  object-fit: contain;
  opacity: 0.9;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  pointer-events: none;
}

.catchphrase-text {
  font-style: italic;
  color: rgba(255, 255, 255, 0.7);
  text-align: center;
  width: 100%;
  max-width: calc(min(400px, 30vw));
  hyphens: auto;
  line-height: 1.3;
  height: 2em;
  font-size: 0.9rem;
}

.project-card-inner {
  width: 460px;
  flex-shrink: 0;
}

.main-menu-list {
  background-color: transparent;
}

.project-list {
  max-height: 300px;
  overflow-y: auto;
}

.list-item {
  background-color: transparent;
}

.list-button {
  border: 1px solid transparent;
}
</style>
