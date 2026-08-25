import { projectIdSchema, type ToolServer, toolResult } from "../shared"

export function defineGetLibraryTool(server: ToolServer): void {
  server.mcp.registerTool(
    "get_library",
    {
      description:
        "Get a compact overview of available component and entity types. Use get_library_objects for complete definitions.",
      inputSchema: {
        project_id: projectIdSchema,
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_id }) => {
      const response = await server.clients.library.getLibrary({ projectId: project_id })

      return toolResult({
        components: Object.values(response.library?.components ?? {}).map(component => ({
          type: component.type,
          title: component.meta?.title ?? component.type,
        })),
        entities: Object.values(response.library?.entities ?? {}).map(entity => ({
          type: entity.type,
          title: entity.meta?.title ?? entity.type,
        })),
      })
    },
  )
}
