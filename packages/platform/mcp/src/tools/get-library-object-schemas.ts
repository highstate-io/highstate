import { type JsonValue, toJson } from "@bufbuild/protobuf"
import { ComponentSchema, EntitySchema } from "@highstate/api/v1"
import { z } from "zod"
import { projectIdSchema, type ToolServer, toolResult } from "../shared"

type ComponentJson = {
  arguments?: Record<string, { schema?: JsonValue }>
}

type EntityJson = {
  schema?: JsonValue
}

const libraryObjectSelectors = {
  project_id: projectIdSchema,
  component_types: z.array(z.string().min(1)).default([]),
  entity_types: z.array(z.string().min(1)).default([]),
}

type ComponentSchemaResult = {
  type: string
  schemas: Record<string, JsonValue>
}

type EntitySchemaResult = {
  type: string
  schema: JsonValue | undefined
}

export function defineGetLibraryObjectSchemasTool(server: ToolServer): void {
  server.mcp.registerTool(
    "get_library_object_schemas",
    {
      description:
        "Get only the large schemas for selected library objects. Request schemas only for the specific component and entity types needed to construct or validate values.",
      inputSchema: libraryObjectSelectors,
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
        entities: Object.values(response.library?.entities ?? {})
          .filter(entity => entityTypes.has(entity.type))
          .map(entity => {
            const entityJson = toJson(EntitySchema, entity, {
              useProtoFieldName: true,
            }) as EntityJson
            return {
              type: entity.type,
              schema: entityJson.schema,
            } satisfies EntitySchemaResult
          }),
      })
    },
  )
}
