import { create } from "@bufbuild/protobuf"
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt"
import { ConnectError } from "@connectrpc/connect"
import { BadRequestSchema, InstanceSchema } from "@highstate/api/v1"
import { describe, expect, it } from "vitest"
import { validateUpdateMask } from "./field-mask"

const mutablePaths = new Set(["arguments", "position", "position.x", "position.y"])

describe("validateUpdateMask", () => {
  it("normalizes JSON and TypeScript field names to Protobuf paths", () => {
    const paths = validateUpdateMask(
      create(FieldMaskSchema, { paths: ["position.x", "arguments"] }),
      InstanceSchema,
      mutablePaths,
    )

    expect(paths).toEqual(["position.x", "arguments"])
  })

  it.each([
    { paths: [] },
    { paths: ["*"] },
    { paths: ["id"] },
    { paths: ["inputs.values"] },
    { paths: ["arguments.value"] },
  ])("rejects invalid paths %j", ({ paths }) => {
    try {
      validateUpdateMask(create(FieldMaskSchema, { paths }), InstanceSchema, mutablePaths)
      expect.fail("Expected update mask validation to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError)
      const connectError = error as ConnectError
      expect(connectError.findDetails(BadRequestSchema)).toHaveLength(1)
    }
  })
})
