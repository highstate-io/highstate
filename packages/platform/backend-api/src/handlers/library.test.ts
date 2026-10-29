import { create } from "@bufbuild/protobuf"
import { Code } from "@connectrpc/connect"
import {
  AddLibraryPackageRequestSchema,
  GetLibraryPackageVersionRequestSchema,
  GetProjectLibraryRequestSchema,
  RetryLibrarySnapshotImageRequestSchema,
} from "@highstate/api/v1"
import { describe, expect, it, vi } from "vitest"
import { createLibraryService } from "./library"

const context = { requestHeader: new Headers({ authorization: "Bearer project-key" }) }
function fixture() {
  const state = {
    selectedPackages: [{ packageName: "@example/library", version: "1.2.3" }],
    desiredSnapshot: null,
    diagnostics: [{ phase: "resolution", message: "Package unavailable" }],
    image: null,
  }

  const getState = vi.fn(async () => state)
  const addPackage = vi.fn()
  const retry = vi.fn()

  const getVersion = vi.fn(async () => ({
    name: "@example/library",
    version: "1.2.3",
    description: "Example",
    dist: {
      tarball: "https://registry.example/private?token=sensitive",
      integrity: "sha512-example",
    },
  }))

  const services = {
    database: {
      backend: { project: { findUnique: async () => ({ id: "project" }) } },
      forProject: async () => ({ serviceAccountRoleBinding: { findMany: async () => [] } }),
    },
    apiKeyService: {
      getProjectCredentialByToken: async () => ({
        id: "key",
        serviceAccountId: "account",
        restrictionRules: [],
      }),
    },
    projectUnlockService: { checkProjectUnlocked: async () => true },
    projectLibraryService: {
      getProjectLibrary: getState,
      addPackage,
      retryDesiredImage: retry,
      getPackageVersion: getVersion,
      getCatalog: async () => ({ overlay: { enabled: false, active: false, conflicts: [] } }),
    },
  }

  return {
    handler: createLibraryService(services as never),
    getState,
    addPackage,
    retry,
    getVersion,
  }
}

describe("project library transport", () => {
  it("keeps initial selections and diagnostics accessible before initial resolution succeeds", async () => {
    const { handler } = fixture()

    const result = await handler.getProjectLibrary(
      create(GetProjectLibraryRequestSchema, { projectId: "project" }),
      context as never,
    )

    expect(result).toMatchObject({
      selectedPackages: [{ packageName: "@example/library", version: "1.2.3" }],
      desiredSnapshot: undefined,
      diagnostics: [{ phase: "resolution", message: "Package unavailable" }],
    })
  })

  it("rejects version ranges before changing the selection", async () => {
    const { handler, addPackage } = fixture()

    await expect(
      handler.addLibraryPackage(
        create(AddLibraryPackageRequestSchema, {
          projectId: "project",
          packageName: "@example/library",
          version: "^1.0.0",
        }),
        context as never,
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument })

    expect(addPackage).not.toHaveBeenCalled()
  })

  it("looks up exact versions without publishing registry download credentials", async () => {
    const { handler, getVersion } = fixture()

    const result = await handler.getLibraryPackageVersion(
      create(GetLibraryPackageVersionRequestSchema, {
        projectId: "project",
        packageName: "@example/library",
        version: "1.2.3",
      }),
      context as never,
    )

    expect(getVersion).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project" }), {
      packageName: "@example/library",
      version: "1.2.3",
    })

    expect(result.packageVersion?.packageMetadata).toMatchObject({ description: "Example" })
    expect(JSON.stringify(result)).not.toContain("sensitive")
  })

  it("reads canonical status after retry rather than converting an adapter-specific image result", async () => {
    const { handler, retry, getState } = fixture()

    await handler.retryLibrarySnapshotImage(
      create(RetryLibrarySnapshotImageRequestSchema, { projectId: "project" }),
      context as never,
    )

    expect(retry).toHaveBeenCalledOnce()
    expect(getState).toHaveBeenCalledOnce()
    expect(retry.mock.invocationCallOrder[0]).toBeLessThan(getState.mock.invocationCallOrder[0]!)
  })
})
