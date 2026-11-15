import type { ProjectOutput, UnlockMethodInput } from "@highstate/backend/shared"
import type { CommonObjectMeta } from "@highstate/contract"

export const useProjectsStore = defineStore("projects", () => {
  const { $client } = useNuxtApp()
  const projects = ref<ProjectOutput[]>([])
  const projectsLoaded = ref(false)
  const access = useAccess()
  const loading = ref(false)
  const error = ref<string>()
  const listAccess = computed(() => access.status({ permission: "project.list", collection: true }))

  async function loadProjects(): Promise<ProjectOutput[]> {
    return await loadAllCollectionItems(query => $client.project.getProjects.query(query))
  }

  let generation = 0
  async function refreshProjects(): Promise<void> {
    const current = ++generation

    if (!listAccess.value.allowed) {
      projects.value = []
      loading.value = false
      return
    }

    loading.value = true
    error.value = undefined

    try {
      const result = await loadProjects()

      if (current !== generation || !listAccess.value.allowed) {
        return
      }

      projects.value = result
    } catch (caught) {
      if (current !== generation) {
        return
      }

      projects.value = []
      error.value = caught instanceof Error ? caught.message : "Failed to load projects"
    } finally {
      if (current === generation) {
        loading.value = false
        projectsLoaded.value = true
      }
    }
  }

  watch(
    () => [listAccess.value.allowed, access.revision.value],
    () => {
      void refreshProjects()
    },
    { immediate: true },
  )

  const loadingCreateProject = ref<boolean>(false)

  const createProject = async (
    id: string,
    name: string,
    meta: CommonObjectMeta,
    unlockMethodInput: UnlockMethodInput,
  ) => {
    loadingCreateProject.value = true

    try {
      const project = await $client.project.createProject.mutate({
        projectId: id,
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
    projectsLoaded,
    loading,
    error,
    listAccess,
    refreshProjects,
    focusedProjectId,
    createProject,
    loadingCreateProject,
    getById,
  }
})
