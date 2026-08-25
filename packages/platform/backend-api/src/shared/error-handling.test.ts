import { Code, ConnectError } from "@connectrpc/connect"
import { BadRequestSchema, ErrorInfoSchema } from "@highstate/api/v1"
import {
  BackendError,
  BackendErrorCategory,
  InvalidPageSizeError,
  PermissionDeniedError,
} from "@highstate/backend/shared"
import { describe, expect, it, vi } from "vitest"
import { createErrorHandlingInterceptor } from "./error-handling"

describe("createErrorHandlingInterceptor", () => {
  it("maps backend errors to structured details", async () => {
    const logger = { error: vi.fn() }
    const interceptor = createErrorHandlingInterceptor({ logger } as never)
    const handler = interceptor(async () => {
      throw new InvalidPageSizeError(-1)
    })

    try {
      await handler({
        method: { name: "ListOperations" },
        header: new Headers({ "x-request-id": "request-1" }),
      } as never)
      expect.fail("Expected handler to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError)
      const connectError = error as ConnectError
      expect(connectError.code).toBe(Code.InvalidArgument)
      expect(connectError.findDetails(ErrorInfoSchema)[0]?.reason).toBe("PAGE_SIZE_INVALID")
      expect(connectError.findDetails(BadRequestSchema)[0]?.fieldViolations[0]?.field).toBe(
        "page_size",
      )
      expect(logger.error).not.toHaveBeenCalled()
    }
  })

  it("sanitizes and logs unexpected errors once", async () => {
    const logger = { error: vi.fn() }
    const interceptor = createErrorHandlingInterceptor({ logger } as never)
    const handler = interceptor(async () => {
      throw new Error("sensitive internal path")
    })

    await expect(
      handler({ method: { name: "GetProject" }, header: new Headers() } as never),
    ).rejects.toMatchObject({ code: Code.Internal, rawMessage: "An unexpected error occurred" })
    expect(logger.error).toHaveBeenCalledOnce()
  })

  it("preserves cancellation without domain details", async () => {
    const logger = { error: vi.fn() }
    const cancellation = new ConnectError("Canceled", Code.Canceled)
    const interceptor = createErrorHandlingInterceptor({ logger } as never)
    const handler = interceptor(async () => {
      throw cancellation
    })

    await expect(
      handler({ method: { name: "Connect" }, header: new Headers() } as never),
    ).rejects.toBe(cancellation)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("preserves unauthenticated and permission-denied classifications without secret metadata", async () => {
    for (const error of [
      new BackendErrorForTest("Authentication required", BackendErrorCategory.Unauthenticated),
      new PermissionDeniedError("project.get"),
    ]) {
      const interceptor = createErrorHandlingInterceptor({ logger: { error: vi.fn() } } as never)
      const handler = interceptor(async () => {
        throw error
      })

      await expect(
        handler({ method: { name: "GetProject" }, header: new Headers() } as never),
      ).rejects.toMatchObject({
        code:
          error.category === BackendErrorCategory.Unauthenticated
            ? Code.Unauthenticated
            : Code.PermissionDenied,
      })
    }

    const secret = new BackendErrorForTest(
      "Authentication failed",
      BackendErrorCategory.Unauthenticated,
      {
        token: "plaintext-token",
        safe: "value",
      },
    )
    const interceptor = createErrorHandlingInterceptor({ logger: { error: vi.fn() } } as never)
    const handler = interceptor(async () => {
      throw secret
    })
    const result = (await handler({
      method: { name: "GetProject" },
      header: new Headers(),
    } as never).catch(error => error as ConnectError)) as ConnectError

    expect(result.findDetails(ErrorInfoSchema)[0]?.metadata).toEqual({ safe: "value" })
    expect(result.rawMessage).not.toContain("plaintext-token")
  })
})

class BackendErrorForTest extends BackendError {
  constructor(
    message: string,
    category: BackendErrorCategory,
    metadata: Record<string, string> = {},
  ) {
    super(message, { category, reason: "AUTHENTICATION_FAILED", metadata })
  }
}
