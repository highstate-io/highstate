import { create } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import { BadRequestSchema, ErrorInfoSchema } from "@highstate/api/v1"
import { describe, expect, it } from "vitest"
import { formatClientError } from "./client"

describe("formatClientError", () => {
  it("includes Connect metadata and decoded details", () => {
    const error = new ConnectError(
      "Invalid project",
      Code.InvalidArgument,
      { "x-request-id": "request-id" },
      [
        {
          desc: ErrorInfoSchema,
          value: create(ErrorInfoSchema, {
            reason: "PROJECT_INVALID",
            domain: "highstate.io",
            metadata: { projectId: "project-id" },
          }),
        },
        {
          desc: BadRequestSchema,
          value: create(BadRequestSchema, {
            fieldViolations: [
              {
                field: "project_id",
                reason: "INVALID",
                description: "The project ID is invalid",
              },
            ],
          }),
        },
      ],
    )

    const result = formatClientError(error, "GetProject", "http://localhost/api/GetProject")

    expect(result).toContain("code: invalid_argument")
    expect(result).toContain("message: Invalid project")
    expect(result).toContain("x-request-id: request-id")
    expect(result).toContain("reason: PROJECT_INVALID")
    expect(result).toContain("field: project_id")
  })

  it("includes non-Connect error cause chains", () => {
    const cause = new Error("Socket closed")
    const error = new Error("Request failed", { cause })

    const result = formatClientError(error, "GetProject", "http://localhost/api/GetProject")

    expect(result).toContain("message: Request failed")
    expect(result).toContain("message: Socket closed")
  })

  it("includes operation planning error messages", () => {
    const error = new ConnectError(
      "Operation options are invalid: ghost options are supported only for updates",
      Code.InvalidArgument,
      undefined,
      [
        {
          desc: ErrorInfoSchema,
          value: create(ErrorInfoSchema, {
            reason: "OPERATION_PLAN_INVALID",
            domain: "highstate.io",
          }),
        },
      ],
    )

    const result = formatClientError(error, "PlanOperation", "http://localhost/PlanOperation")

    expect(result).toContain("code: invalid_argument")
    expect(result).toContain(
      'message: "Operation options are invalid: ghost options are supported only for updates"',
    )
    expect(result).toContain("reason: OPERATION_PLAN_INVALID")
  })
})
