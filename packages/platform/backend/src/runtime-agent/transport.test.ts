import protobuf from "protobufjs"
import { describe, expect, it } from "vitest"
import { valueFromWire, valueToWire } from "./transport"

describe("runtime JSON values", () => {
  it("preserves false, true, and nested values across actual protobuf encoding", async () => {
    const root = new protobuf.Root()
    const schema = protobuf.common.get("google/protobuf/struct.proto")
    if (!schema?.nested) {
      throw new Error("Protobuf Value schema not found")
    }

    root.addJSON(schema.nested)
    const type = root.lookupType("google.protobuf.Value")

    for (const value of [false, true, { hooks: false, values: [true, 0, "", null] }]) {
      const bytes = type.encode(type.fromObject(valueToWire(value))).finish()
      expect(valueFromWire(type.toObject(type.decode(bytes)))).toEqual(value)
    }
  })
})
