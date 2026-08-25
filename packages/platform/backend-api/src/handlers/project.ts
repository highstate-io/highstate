import type { ServiceImpl } from "@connectrpc/connect"
import type { ProjectService } from "@highstate/api/v1"
import type { Services } from "@highstate/backend"
import { authenticateBackend, authenticateProject, toProject } from "../shared"

export function createProjectService(services: Services): ServiceImpl<typeof ProjectService> {
  return {
    async getProject(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const [project, unlockState] = await Promise.all([
        services.projectService.getProjectOrThrowCore(requestContext.projectId),
        services.projectUnlockService.getProjectUnlockStateCore(requestContext.projectId),
      ])

      return {
        project: toProject(project),
        isLocked: unlockState.type === "locked",
      }
    },

    async listProjects(request, context) {
      const requestContext = await authenticateBackend(services, context)
      const result = await services.projectService.getProjects(requestContext, {
        pageSize: request.pageSize,
        pageToken: request.pageToken,
      })
      const projects = await Promise.all(
        result.items.map(async project => {
          const unlockState = await services.projectUnlockService.getProjectUnlockStateCore(
            project.id,
          )

          return {
            project: toProject(project),
            isLocked: unlockState.type === "locked",
          }
        }),
      )

      return {
        projects,
        nextPageToken: result.nextPageToken,
      }
    },
  }
}
