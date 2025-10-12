import {
  componentModelSchema,
  entityModelSchema,
  hubModelSchema,
  instanceModelSchema,
  objectMetaSchema,
  type EntityModel,
  type HubModel,
  type InstanceModel,
  type Position,
} from "@highstate/contract"
import { decode, encode } from "@msgpack/msgpack"
import { uniqueBy } from "remeda"
import { z } from "zod"
import { Base64 } from "js-base64"
import { getRectOfNodes, type GraphNode, type VueFlowStore } from "@vue-flow/core"

/**
 * The visual status of a node in the blueprint placement context.
 *
 * - `blueprint-valid`: The node is part of a blueprint being placed and can be placed at the current location.
 * - `blueprint-invalid`: The node is part of a blueprint being placed but conflicts with existing objects.
 */
export type BlueprintStatus = "blueprint-valid" | "blueprint-invalid"

export const blueprintSchema = z.object({
  /**
   * The metadata of the blueprint.
   */
  meta: objectMetaSchema.optional(),

  /**
   * The size of the blueprint boundary
   * All instances in the blueprint must fit within this boundary.
   */
  boundary: z.object({
    width: z.number(),
    height: z.number(),
  }),

  /**
   * The instances that are part of the blueprint.
   */
  instances: instanceModelSchema.array(),

  /**
   * The hubs that are part of the blueprint.
   */
  hubs: hubModelSchema.array(),

  /**
   * The components referenced by the instances in the blueprint.
   *
   * Used to create self-contained blueprints that can be placed
   * even if the target library does not contain all necessary components.
   */
  components: componentModelSchema.array().optional(),

  /**
   * The entities referenced by the components in the blueprint.
   *
   * Used to create self-contained blueprints that can be placed
   * even if the target library does not contain all necessary entities.
   */
  entities: entityModelSchema.array().optional(),
})

export type Blueprint = z.infer<typeof blueprintSchema>

const blueprintPrefix = "highstate.io/share#"

/**
 * Serializes the blueprint for the given instances. All their components and entities must be provided.
 */
export function serializeBlueprint(blueprint: Blueprint): string {
  const encoded = encode(blueprint)
  const base64 = Base64.fromUint8Array(encoded, true)

  return `${blueprintPrefix}${base64}`
}

function moveCanvasNode<TNode extends { position?: Position }>(
  node: TNode,
  relativeTo: Position,
): TNode {
  if (!node.position) {
    return {
      ...node,
      position: { x: 0, y: 0 },
    }
  }

  return {
    ...node,
    position: {
      x: node.position.x - relativeTo.x,
      y: node.position.y - relativeTo.y,
    },
  }
}

/**
 * Creates a blueprint from the given instances and hubs.
 * The components and entities are taken from the library store.
 */
export function createBlueprint(
  nodes: GraphNode[],
  instances: InstanceModel[],
  hubs: HubModel[],
  libraryStore?: LibraryStore,
): Blueprint {
  const rect = getRectOfNodes(nodes)

  // move all instances and hubs to the top-left corner of the blueprint
  const movedInstances = instances.map(instance => moveCanvasNode(instance, rect))
  const movedHubs = hubs.map(hub => moveCanvasNode(hub, rect))

  if (!libraryStore) {
    return {
      boundary: { width: rect.width, height: rect.height },
      instances: movedInstances,
      hubs: movedHubs,
    }
  }

  const components = uniqueBy(
    instances.map(instance => libraryStore.components[instance.type]),
    component => component.type,
  )

  const entities = new Map<string, EntityModel>()
  for (const component of components) {
    // we assume that all components have their entities defined in the library
    // the same is true for components of instances

    for (const input of Object.values(component.inputs)) {
      if (entities.has(input.type)) {
        continue
      }

      const entity = libraryStore.entities[input.type]
      entities.set(input.type, entity)
    }

    for (const output of Object.values(component.outputs)) {
      if (entities.has(output.type)) {
        continue
      }

      const entity = libraryStore.entities[output.type]
      entities.set(output.type, entity)
    }
  }

  return {
    boundary: { width: rect.width, height: rect.height },
    instances: movedInstances,
    hubs: movedHubs,
    components,
    entities: Array.from(entities.values()),
  }
}

/**
 * Parses the blueprint from the given string.
 * Returns `null` if the string is not a valid blueprint.
 */
export function parseBlueprint(blueprint: string): Blueprint | null {
  if (!blueprint.startsWith(blueprintPrefix)) {
    return null
  }

  try {
    const base64 = blueprint.slice(blueprintPrefix.length)
    const encoded = Base64.toUint8Array(base64)
    const decoded = decode(encoded)

    return blueprintSchema.parse(decoded)
  } catch (error) {
    // TODO: indicate the error in the UI

    globalLogger.error({ error, blueprint }, "failed to parse blueprint")
    return null
  }
}

export function getBlueprintStatus(
  node: GraphNode,
  vueFlowStore: VueFlowStore,
): BlueprintStatus | undefined {
  if (!node.data.blueprint) {
    return undefined
  }

  const intersections = vueFlowStore.getIntersectingNodes(node)
  if (intersections.length > 0) {
    return "blueprint-invalid"
  }

  return "blueprint-valid"
}
