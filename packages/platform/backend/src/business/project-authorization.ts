import type { BackendPermissionTarget } from "../common"
import type { DatabaseManager } from "../database"

export async function resolveBackendProjectPermissionTarget(
  database: DatabaseManager,
  projectId: string,
): Promise<BackendPermissionTarget> {
  const project = await database.backend.project.findUnique({
    where: { id: projectId },
    select: { spaceId: true },
  })

  if (!project) {
    return { projectId }
  }

  const spaces = await database.backend.projectSpace.findMany({
    select: { id: true, parentId: true },
  })
  const parentIds = new Map(spaces.map(space => [space.id, space.parentId]))
  const ancestorProjectSpaceIds: string[] = []
  const visitedSpaceIds = new Set<string>()
  let parentId = parentIds.get(project.spaceId)

  while (parentId && parentIds.has(parentId) && !visitedSpaceIds.has(parentId)) {
    visitedSpaceIds.add(parentId)
    ancestorProjectSpaceIds.push(parentId)
    parentId = parentIds.get(parentId)
  }

  return {
    projectId,
    projectSpaceId: project.spaceId,
    ancestorProjectSpaceIds,
  }
}
