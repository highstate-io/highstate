import type { UnlockMethodInput } from "@highstate/backend/shared"
import type { CommonObjectMeta } from "@highstate/contract"

export const useProjectsStore = defineStore("projects", () => {
  const { $client } = useNuxtApp()
  const { execute: refreshProjects, data: projectsData } = $client.project.getProjects.useQuery()
  const projects = refDefault(
    computed(() => projectsData.value),
    [],
  )

  const loadingCreateProject = ref<boolean>(false)

  const createProject = async (
    name: string,
    meta: CommonObjectMeta,
    unlockMethodInput: UnlockMethodInput,
  ) => {
    loadingCreateProject.value = true

    try {
      const project = await $client.project.createProject.mutate({
        projectInput: {
          meta,
          name,
        },
        unlockMethodInput,
      })

      await refreshProjects()

      return project
    } finally {
      loadingCreateProject.value = false
    }
  }

  const getById = (id: string) => {
    return projects.value.find(project => project.id === id)
  }

  const focusedProjectId = ref<string | null>(null)

  return {
    projects,
    focusedProjectId,
    createProject,
    loadingCreateProject,
    getById,
  }
})
