import type { ServiceImpl } from "@connectrpc/connect"
import type { ProjectService } from "@highstate/api/v1"
import type { Services } from "@highstate/backend"
import { projectPlacementInputSchema } from "@highstate/backend/shared"
import { z } from "@highstate/contract"
import { authenticateBackend, authenticateProject, parseValue, toProject } from "../shared"

export function createProjectService(services: Services): ServiceImpl<typeof ProjectService> {
  return {
    async updateProjectPlacement(request, context) {
      const requestContext = await authenticateBackend(services, context)
      const projectId = parseValue(request.projectId, "projectId", z.string().min(1))
      const input = parseValue(request, "request", projectPlacementInputSchema)
      const project = await services.projectService.updateProjectPlacement(
        requestContext,
        projectId,
        input,
      )

      return { project: toProject(project) }
    },

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
