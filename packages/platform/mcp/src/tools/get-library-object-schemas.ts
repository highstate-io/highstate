import { type JsonValue, toJson } from "@bufbuild/protobuf"
import { ComponentSchema } from "@highstate/api/v1"
import { z } from "zod"
import { projectIdSchema, type ToolServer, toolResult } from "../shared"

type ComponentJson = {
  arguments?: Record<string, { schema?: JsonValue }>
}

const libraryObjectSelectors = {
  project_id: projectIdSchema,
  component_types: z.array(z.string().min(1)).default([]),
}

type ComponentSchemaResult = {
  type: string
  schemas: Record<string, JsonValue>
}

export function defineGetLibraryObjectSchemasTool(server: ToolServer): void {
  server.mcp.registerTool(
    "get_library_object_schemas",
    {
      description:
        "Get argument schemas for selected component types. Request schemas only for the specific components needed to construct argument values.",
      inputSchema: libraryObjectSelectors,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_id, component_types }) => {
      const response = await server.clients.library.getLibrary({ projectId: project_id })
      const componentTypes = new Set(component_types)

      return toolResult({
        components: Object.values(response.library?.components ?? {})
          .filter(component => componentTypes.has(component.type))
          .map(component => {
            const componentJson = toJson(ComponentSchema, component, {
              useProtoFieldName: true,
            }) as ComponentJson
            return {
              type: component.type,
              schemas: Object.fromEntries(
                Object.entries(componentJson.arguments ?? {}).flatMap(([name, argument]) =>
                  argument.schema === undefined ? [] : [[name, argument.schema]],
                ),
              ),
            } satisfies ComponentSchemaResult
          }),
      })
    },
  )
}
