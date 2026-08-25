import { describe, expect, vi } from "vitest"
import { PermissionDeniedError } from "../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../test-utils"
import { ApiKeyService } from "./api-key"

describe("ApiKeyService authorization", () => {
  test("requires api-key.rotate for project rotation", async ({ database, project }) => {
    const service = new ApiKeyService(database, {} as never)
    vi.spyOn((await database.forProject(project.id)).apiKey, "findUnique").mockResolvedValue({
      id: "api-key",
      serviceAccountId: "service-account",
      serviceAccount: { meta: {} },
      worker: null,
    } as never)

    await expect(
      service.rotateProjectApiKey(createProjectRequestContext(project.id), "missing"),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.rotateProjectApiKey(
        createProjectRequestContext(project.id, grantProjectPermission("api-key.rotate")),
        "missing",
      ),
    ).rejects.not.toThrow(PermissionDeniedError)
  })
})
