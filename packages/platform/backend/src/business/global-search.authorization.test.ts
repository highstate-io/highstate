import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../shared"
import { createBackendRequestContext, grantBackendPermission, test } from "../test-utils"
import { GlobalSearchService } from "./global-search"

describe("GlobalSearchService authorization", () => {
  test("requires backend.search for both search methods", async ({ database }) => {
    const service = new GlobalSearchService(database, {} as never, {} as never)

    await expect(service.searchByIds(createBackendRequestContext(), [])).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(service.searchByText(createBackendRequestContext(), "query")).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(
      service.searchByIds(
        createBackendRequestContext(grantBackendPermission("backend.search")),
        [],
      ),
    ).resolves.toEqual([])
  })
})
