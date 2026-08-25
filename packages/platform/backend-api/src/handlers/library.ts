import type { ServiceImpl } from "@connectrpc/connect"
import type { Services } from "@highstate/backend"
import { ComponentKind, type LibraryService } from "@highstate/api/v1"
import { ComponentNotFoundError } from "@highstate/backend/shared"
import { z } from "@highstate/contract"
import { authenticateProject, parseArgument, toComponent, toLibrary } from "../shared"

export function createLibraryService(services: Services): ServiceImpl<typeof LibraryService> {
  return {
    async getLibrary(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const library = await services.libraryService.getLibraryModel(requestContext, context.signal)

      return {
        library: toLibrary({
          components: { ...library.components },
          entities: { ...library.entities },
        }),
      }
    },

    async listComponents(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const page = await services.libraryService.getComponents(
        requestContext,
        { pageSize: request.pageSize, pageToken: request.pageToken },
        context.signal,
      )

      return {
        components: page.items.map(component => ({
          type: component.type,
          kind: component.kind === "unit" ? ComponentKind.UNIT : ComponentKind.COMPOSITE,
          meta: {
            title: component.meta.title,
            description: component.meta.description,
            color: component.meta.color,
            icon: component.meta.icon,
            iconColor: component.meta.iconColor,
            secondaryIcon: component.meta.secondaryIcon,
            secondaryIconColor: component.meta.secondaryIconColor,
            category: component.meta.category,
            defaultNamePrefix: component.meta.defaultNamePrefix,
          },
        })),
        nextPageToken: page.nextPageToken,
      }
    },

    async getComponent(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const type = parseArgument(request, "type", z.string().min(1))
      const library = await services.libraryService.getLibraryModel(requestContext, context.signal)
      const component = library.components[type]

      if (!component) {
        throw new ComponentNotFoundError(requestContext.projectId, type)
      }

      return { component: toComponent(component) }
    },
  }
}
