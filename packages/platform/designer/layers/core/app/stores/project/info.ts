import type { ProjectOutput } from "@highstate/backend/shared"

export const useProjectInfoStore = defineMultiStore({
  name: "project-info",
  getStoreId: (projectId: string) => `projects/${projectId}/info`,

  create: ({ storeId, id: [projectId], logger }) => {
    return defineStore(storeId, () => {
      const initialized = ref(false)
      const projectInfo = ref<ProjectOutput | null>(null)

      const { $client } = useNuxtApp()

      const initialize = async () => {
        logger.info({ projectId }, "initializing project info store")

        // load project info first
        projectInfo.value = await $client.project.getProject.query({ projectId })

        logger.info({ projectId, projectInfo: projectInfo.value }, "project info store initialized")
        initialized.value = true
      }

      return {
        projectId,

        initialized: readonly(initialized),
        initialize,

        projectInfo: computed(() => {
          if (!projectInfo.value) {
            throw new Error("Project info not loaded")
          }

          return projectInfo.value
        }),
      }
    })
  },
})
