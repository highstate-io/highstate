import { create } from "@bufbuild/protobuf"
import { Code } from "@connectrpc/connect"
import { CreateProjectRequestSchema, UnlockProjectRequestSchema } from "@highstate/api/v1"
import {
  codebaseProjectModelStorage,
  globalProjectSpace,
  localContainerRuntime,
  localPulumiStateBackend,
} from "@highstate/backend/shared"
import { describe, expect, it, vi } from "vitest"
import { createProjectService } from "./project"

const context = { requestHeader: new Headers({ authorization: "Bearer backend-key" }) }
const projectId = "tz4a98xxat96iws9zmbrgj3a"
const definition = { name: "example", meta: { title: "Example" } }
const unlockMethod = {
  type: "password",
  meta: { title: "Password" },
  recipient: "age-recipient",
  encryptedIdentity: "client-encrypted-identity",
}

function fixture() {
  const createProject = vi.fn(async () => ({
    ...definition,
    id: projectId,
    spaceId: globalProjectSpace.id,
    modelStorageId: codebaseProjectModelStorage.id,
    containerRuntimeId: localContainerRuntime.id,
    pulumiStateBackendId: localPulumiStateBackend.id,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }))
  const unlockProject = vi.fn()
  const authenticate = vi.fn(async () => ({
    id: "key",
    serviceAccountId: "admin",
    restrictionRules: [],
  }))
  const handler = createProjectService({
    projectService: { createProject },
    projectUnlockService: { unlockProject },
    apiKeyService: { getBackendApiKeyByToken: authenticate },
    database: {
      backend: { serviceAccountBackendRoleBinding: { findMany: async () => [] } },
    },
  } as never)
  return { handler, createProject, unlockProject, authenticate }
}

describe("project lifecycle transport", () => {
  it("creates through the domain service with defaults and backend authorization", async () => {
    const { handler, createProject, authenticate } = fixture()
    const response = await handler.createProject(
      create(CreateProjectRequestSchema, { project: definition, unlockMethod }),
      context as never,
    )
    expect(authenticate).toHaveBeenCalledWith("backend-key")
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        realm: "backend",
        subject: { type: "service-account", serviceAccountId: "admin", apiKeyId: "key" },
      }),
      {
        ...definition,
        spaceId: globalProjectSpace.id,
        modelStorageId: codebaseProjectModelStorage.id,
        containerRuntimeId: localContainerRuntime.id,
        pulumiStateBackendId: localPulumiStateBackend.id,
      },
      unlockMethod,
      undefined,
    )
    expect(response.project).toMatchObject({ id: projectId, ...definition })
  })

  it("preserves reserved IDs, explicit placement, and client-prepared passkey credentials", async () => {
    const { handler, createProject } = fixture()
    const passkey = { ...unlockMethod, type: "passkey", passkeyIdentity: "opaque-passkey" }
    await handler.createProject(
      create(CreateProjectRequestSchema, {
        projectId,
        project: { ...definition, containerRuntimeId: "remote", pulumiStateBackendId: "state" },
        unlockMethod: passkey,
      }),
      context as never,
    )
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ realm: "backend" }),
      expect.objectContaining({ containerRuntimeId: "remote", pulumiStateBackendId: "state" }),
      passkey,
      projectId,
    )
  })

  it.each([
    {},
    { project: definition },
    { project: definition, unlockMethod: { ...unlockMethod, type: "unknown" } },
    { project: definition, unlockMethod: { ...unlockMethod, type: "passkey" } },
    { project: definition, unlockMethod, projectId: "invalid-project-id" },
  ])("rejects invalid create input before mutation: %j", async input => {
    const { handler, createProject } = fixture()
    await expect(
      handler.createProject(create(CreateProjectRequestSchema, input), context as never),
    ).rejects.toMatchObject({ code: Code.InvalidArgument })
    expect(createProject).not.toHaveBeenCalled()
  })

  it.each([
    "AGE-SECRET-KEY-example",
    "",
  ])("unlocks using backend credentials without requiring an unlocked project: %j", async decryptedIdentity => {
    const { handler, unlockProject } = fixture()
    await handler.unlockProject(
      create(UnlockProjectRequestSchema, { projectId, decryptedIdentity }),
      context as never,
    )
    expect(unlockProject).toHaveBeenCalledWith(
      expect.objectContaining({ realm: "backend" }),
      projectId,
      decryptedIdentity,
    )
  })

  it("requires authentication for both lifecycle mutations", async () => {
    const { handler, createProject, unlockProject } = fixture()
    const anonymous = { requestHeader: new Headers() }
    await expect(
      handler.createProject(
        create(CreateProjectRequestSchema, { project: definition, unlockMethod }),
        anonymous as never,
      ),
    ).rejects.toMatchObject({ code: Code.Unauthenticated })
    await expect(
      handler.unlockProject(create(UnlockProjectRequestSchema, { projectId }), anonymous as never),
    ).rejects.toMatchObject({ code: Code.Unauthenticated })
    expect(createProject).not.toHaveBeenCalled()
    expect(unlockProject).not.toHaveBeenCalled()
  })

  it("rejects an empty unlock project ID before mutation", async () => {
    const { handler, unlockProject } = fixture()
    await expect(
      handler.unlockProject(create(UnlockProjectRequestSchema), context as never),
    ).rejects.toMatchObject({ code: Code.InvalidArgument })
    expect(unlockProject).not.toHaveBeenCalled()
  })
})
