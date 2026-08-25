import { type JsonValue, toJson } from "@bufbuild/protobuf"
import { ComponentSchema, EntitySchema } from "@highstate/api/v1"
import { z } from "zod"
import { projectIdSchema, type ToolServer, toolResult } from "../shared"

type ComponentJson = {
  arguments?: Record<string, Record<string, JsonValue>>
  [key: string]: JsonValue | undefined
}

type EntityJson = {
  schema?: JsonValue
  [key: string]: JsonValue | undefined
}

export function defineGetLibraryObjectsTool(server: ToolServer): void {
  server.mcp.registerTool(
    "get_library_objects",
    {
      description:
        "Get component and entity definitions selected from the library overview, excluding large argument and value schemas. Use get_library_object_schemas only for the specific objects whose schemas are needed.",
      inputSchema: {
        project_id: projectIdSchema,
        component_types: z.array(z.string().min(1)).default([]),
        entity_types: z.array(z.string().min(1)).default([]),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_id, component_types, entity_types }) => {
      const response = await server.clients.library.getLibrary({ projectId: project_id })
      const componentTypes = new Set(component_types)
      const entityTypes = new Set(entity_types)

      return toolResult({
        components: Object.values(response.library?.components ?? {})
          .filter(component => componentTypes.has(component.type))
          .map(component => {
            const { arguments: componentArguments, ...componentWithoutArguments } = toJson(
              ComponentSchema,
              component,
              { useProtoFieldName: true },
            ) as ComponentJson

            return {
              ...componentWithoutArguments,
              arguments: Object.fromEntries(
                Object.entries(componentArguments ?? {}).map(([name, argument]) => {
                  const { schema: _schema, ...argumentWithoutSchema } = argument
                  return [name, argumentWithoutSchema]
                }),
              ),
            }
          }),
        entities: Object.values(response.library?.entities ?? {})
          .filter(entity => entityTypes.has(entity.type))
          .map(entity => {
            const { schema: _schema, ...entityWithoutSchema } = toJson(EntitySchema, entity, {
              useProtoFieldName: true,
            }) as EntityJson
            return entityWithoutSchema
          }),
      })
    },
  )
}
