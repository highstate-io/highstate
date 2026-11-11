import { ProjectService } from "@highstate/api/v1"
import { describe, expect, test, vi } from "vitest"
import { createBackendApiFetchHandler } from "./index"

describe("Fetch API host", () => {
  test("consumes streamed requests and forwards authentication and domain arguments", async () => {
    const unlockProject = vi.fn()

    const authenticate = vi.fn(async () => ({
      id: "key",
      serviceAccountId: "admin",
      restrictionRules: [],
    }))

    const handler = createBackendApiFetchHandler({
      projectUnlockService: { unlockProject },
      apiKeyService: { getBackendApiKeyByToken: authenticate },
      database: { backend: { serviceAccountBackendRoleBinding: { findMany: async () => [] } } },
    } as never)

    const response = await handler(
      new Request(`http://designer.test/${ProjectService.typeName}/UnlockProject`, {
        method: "POST",
        headers: {
          authorization: "Bearer backend-key",
          "content-type": "application/json",
          "connect-protocol-version": "1",
        },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"projectId":"project",'))
            controller.enqueue(new TextEncoder().encode('"decryptedIdentity":"identity"}'))
            controller.close()
          },
        }),
        duplex: "half",
      } as RequestInit),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect(authenticate).toHaveBeenCalledWith("backend-key")

    expect(unlockProject).toHaveBeenCalledWith(
      expect.objectContaining({ realm: "backend" }),
      "project",
      "identity",
    )

    expect((await handler(new Request("http://designer.test/missing"))).status).toBe(404)
  })
})
