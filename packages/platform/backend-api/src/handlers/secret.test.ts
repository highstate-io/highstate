import type { HandlerContext } from "@connectrpc/connect"
import type { Services } from "@highstate/backend"
import { create } from "@bufbuild/protobuf"
import {
  GetSecretContentRequestSchema,
  ListSecretsRequestSchema,
  UpdateInstanceSecretsRequestSchema,
} from "@highstate/api/v1"
import { describe, expect, it, vi } from "vitest"
import { createSecretService } from "./secret"

const authorization = expect.objectContaining({ projectId: "project", realm: "project" })

function authenticatedServices(services: object): Services {
  return {
    database: {
      backend: { project: { findUnique: async () => ({ id: "project" }) } },
      forProject: async () => ({ serviceAccountRoleBinding: { findMany: async () => [] } }),
    },
    projectUnlockService: { checkProjectUnlocked: async () => true },
    apiKeyService: {
      getProjectCredentialByToken: async () => ({
        id: "key",
        serviceAccountId: "account",
        restrictionRules: [],
      }),
    },
    ...services,
  } as unknown as Services
}

const id = "tz4a98xxat96iws9zmbrgj3a"
const context = { requestHeader: new Headers({ authorization: "Bearer test" }) } as HandlerContext

describe("secret API", () => {
  it("delegates content reads to value authorization without requiring metadata permission", async () => {
    const getValue = vi.fn(async () => false)
    const services = authenticatedServices({ secretSettingsService: { getValue } })

    const response = await createSecretService(services).getSecretContent(
      create(GetSecretContentRequestSchema, { projectId: "project", secretId: id }),
      context,
    )

    expect(getValue).toHaveBeenCalledWith(authorization, id)
    expect(response.content).toMatchObject({ kind: { case: "boolValue", value: false } })
  })

  it("returns metadata pages without leaking content", async () => {
    const query = vi.fn(async () => ({
      items: [{ id, meta: { title: "Key" }, content: "must not leak" }],
      nextPageToken: "next",
    }))

    const services = authenticatedServices({ secretSettingsService: { query } })

    const response = await createSecretService(services).listSecrets(
      create(ListSecretsRequestSchema, { projectId: "project", stateId: id, pageSize: 2 }),
      context,
    )

    expect(query).toHaveBeenCalledWith(
      authorization,
      expect.objectContaining({ stateId: id, pageSize: 2 }),
    )

    expect(response.nextPageToken).toBe("next")
    expect(response.secrets).toHaveLength(1)
    expect(JSON.stringify(response)).not.toContain("must not leak")
  })

  it("preserves JSON values and never echoes updated secrets", async () => {
    const updateInstanceSecrets = vi.fn()
    const services = authenticatedServices({ secretService: { updateInstanceSecrets } })
    const secrets = { token: "private", enabled: false, nested: { value: null } }

    const response = await createSecretService(services).updateInstanceSecrets(
      create(UpdateInstanceSecretsRequestSchema, { projectId: "project", stateId: id, secrets }),
      context,
    )

    expect(updateInstanceSecrets).toHaveBeenCalledWith(authorization, id, secrets)
    expect(response).toEqual({})
  })

  it("rejects missing values before updating", async () => {
    const updateInstanceSecrets = vi.fn()
    const services = authenticatedServices({ secretService: { updateInstanceSecrets } })

    await expect(
      createSecretService(services).updateInstanceSecrets(
        create(UpdateInstanceSecretsRequestSchema, { projectId: "project", stateId: id }),
        context,
      ),
    ).rejects.toThrow("Secret values are required")

    expect(updateInstanceSecrets).not.toHaveBeenCalled()
  })
})
