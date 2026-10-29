import type {
  ProjectOutput,
  ProjectPlacementInput,
  UnlockMethodInput,
} from "@highstate/backend/shared"
import type { CommonObjectMeta } from "@highstate/contract"

export const useProjectsStore = defineStore("projects", () => {
  const { $client } = useNuxtApp()
  const projects = ref<ProjectOutput[]>([])

  async function loadProjects(): Promise<ProjectOutput[]> {
    return await loadAllCollectionItems(query => $client.project.getProjects.query(query))
  }

  async function refreshProjects(): Promise<void> {
    projects.value = await loadProjects()
  }

  void refreshProjects()

  const loadingCreateProject = ref<boolean>(false)

  const createProject = async (
    id: string,
    name: string,
    meta: CommonObjectMeta,
    unlockMethodInput: UnlockMethodInput,
    placement?: Pick<ProjectPlacementInput, "containerRuntimeId" | "pulumiStateBackendId">,
  ) => {
    loadingCreateProject.value = true

    try {
      const project = await $client.project.createProject.mutate({
        projectId: id,
        projectInput: {
          meta,
          name,
          ...placement,
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

  async function updatePlacement(projectId: string, placement: ProjectPlacementInput) {
    const result = await $client.project.updatePlacement.mutate({ projectId, placement })
    projects.value = projects.value.map(project => (project.id === projectId ? result : project))
    return result
  }

  return {
    projects,
    focusedProjectId,
    createProject,
    loadingCreateProject,
    getById,
    updatePlacement,
  }
})
