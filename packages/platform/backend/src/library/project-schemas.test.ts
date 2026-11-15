import { componentModelSchema } from "@highstate/contract"
import { decode, encode } from "@msgpack/msgpack"
import { describe, expect, it } from "vitest"
import { libraryModelSchema } from "./project-schemas"

const argument = {
  schema: { type: "string" },
  required: false,
  meta: { title: "Retention period" },
}

const component = {
  type: "influxdb3.database.v1",
  kind: "composite",
  args: { retention_period: argument },
  inputs: {},
  outputs: {},
  definitionHash: 42,
  meta: { title: "Database", defaultNamePrefix: "database" },
}

describe("published library artifact compatibility", () => {
  it("reads published null inclusion lists without changing argument identities or JSON schemas", () => {
    const artifact = decode(
      encode({
        components: { [component.type]: component },
        entities: {
          "common.file.v1": {
            type: "common.file.v1",
            definitionHash: 42,
            schema: { type: "object", default: null },
            meta: { title: "File" },
            inclusions: null,
            directInclusions: null,
          },
        },
      }),
    )

    const model = libraryModelSchema.parse(artifact)
    expect(model.components[component.type]?.args.retention_period).toEqual(argument)
    expect(model.entities["common.file.v1"]?.inclusions).toBeUndefined()
    expect(model.entities["common.file.v1"]?.directInclusions).toBeUndefined()
    expect(model.entities["common.file.v1"]?.schema).toEqual({ type: "object", default: null })
    expect(libraryModelSchema.parse(model)).toEqual(model)
  })

  it("does not weaken authoring validation or accept unrelated malformed arguments", () => {
    expect(componentModelSchema.safeParse(component).success).toBe(false)

    expect(
      libraryModelSchema.safeParse({
        components: { "other.database.v1": { ...component, type: "other.database.v1" } },
        entities: {},
      }).success,
    ).toBe(false)

    expect(
      libraryModelSchema.safeParse({
        components: { [component.type]: { ...component, args: { another_argument: argument } } },
        entities: {},
      }).success,
    ).toBe(false)
  })

  it("continues to reject malformed inclusion lists", () => {
    expect(
      libraryModelSchema.safeParse({
        components: {},
        entities: {
          "common.file.v1": {
            type: "common.file.v1",
            definitionHash: 42,
            schema: {},
            meta: { title: "File" },
            inclusions: "invalid",
          },
        },
      }).success,
    ).toBe(false)
  })
})
