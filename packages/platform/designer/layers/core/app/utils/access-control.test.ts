import { describe, expect, test, vi } from "vitest"
import { accessError, createAccessController } from "./access-control"

describe("permission-aware interaction state", () => {
  test("recognizes middleware rejections carried in tRPC HTTP response metadata", () => {
    expect(accessError({ meta: { response: { status: 401 } } })?.unauthorized).toBe(true)
    expect(accessError({ meta: { response: { status: 403 } } })?.unauthorized).toBe(false)
    expect(accessError({ meta: { response: { status: 500 } } })).toBeUndefined()
  })

  test("suppresses fallback notices when the rejection is explained locally", () => {
    const access = createAccessController(async () => [])

    access.reject(
      { data: { code: "FORBIDDEN" }, message: 'Permission "role.list" is required' },
      "roles",
    )

    const message = access.rejection.value!.message
    access.explain("A different restriction")
    expect(access.rejection.value).not.toBeUndefined()
    access.explain(message)
    expect(access.rejection.value).toBeUndefined()
    access.reject({ data: { code: "UNAUTHORIZED" } }, "session")
    access.explain(access.rejection.value!.message)
    expect(access.rejection.value?.unauthorized).toBe(true)
  })

  test("does not restore a permission from a stale query after a pushed revocation", async () => {
    let resolve!: (result: { key: string; allowed: boolean }[]) => void

    const access = createAccessController(
      () =>
        new Promise(done => {
          resolve = done
        }),
    )

    access.status({ permission: "project.create" })
    const pending = access.flush()
    const key = access.checks.value[0]!.key
    access.apply([{ key, allowed: false }])
    resolve([{ key, allowed: true }])
    await pending
    expect(access.status({ permission: "project.create" }).allowed).toBe(false)
  })

  test("fails closed until checks complete and requires every selected target", async () => {
    const check = vi.fn(async checks =>
      checks.map((item: { key: string; target?: { resourceId?: string } }) => ({
        key: item.key,
        allowed: item.target?.resourceId !== "denied",
      })),
    )

    const access = createAccessController(check)
    const allowed = { permission: "role.update" as const, target: { resourceId: "allowed" } }
    const denied = { permission: "role.update" as const, target: { resourceId: "denied" } }
    expect(access.status([allowed, denied])).toMatchObject({ allowed: false, pending: true })
    await access.flush()
    expect(access.status(allowed).allowed).toBe(true)

    expect(access.status([allowed, denied])).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("role.update"),
    })

    expect(() => access.requireAccess(denied)).toThrow()
  })

  test("does not confuse backend, project, or resource scopes after rejection", async () => {
    const access = createAccessController(async checks =>
      checks.map(item => ({ key: item.key, allowed: true })),
    )

    const backend = { permission: "api-key.update" as const, target: { resourceId: "one" } }
    const project = { ...backend, projectId: "project" }
    const other = { ...project, target: { resourceId: "two" } }
    access.status([backend, project, other])
    await access.flush()

    access.reject(
      { data: { code: "FORBIDDEN" }, message: 'Permission "api-key.update" is required' },
      "projectApiKeySettings.update",
      { projectId: "project", apiKeyId: "one" },
    )

    expect(access.status(project).allowed).toBe(false)
    expect(access.status(backend).allowed).toBe(true)
    expect(access.status(other).allowed).toBe(true)
  })

  test("refreshes revoked grants and restores access without accepting stale responses", async () => {
    let granted = true

    const access = createAccessController(async checks =>
      checks.map(item => ({ key: item.key, allowed: granted })),
    )

    const requirement = { permission: "project.create" as const }
    access.status(requirement)
    await access.flush()
    expect(access.status(requirement).allowed).toBe(true)
    granted = false
    await access.recheck()
    expect(access.status(requirement).allowed).toBe(false)
    expect(access.revision.value).toBe(1)
    granted = true
    access.refresh()
    await access.flush()
    expect(access.status(requirement).allowed).toBe(true)
  })

  test("disables every protected action on session expiry and does not expose server errors", async () => {
    const access = createAccessController(async checks =>
      checks.map(item => ({ key: item.key, allowed: true })),
    )

    const requirement = { permission: "project.create" as const }
    access.status(requirement)
    await access.flush()

    access.reject(
      { data: { code: "UNAUTHORIZED" }, message: "private server details" },
      "project.createProject",
    )

    expect(access.authenticated.value).toBe(false)

    expect(access.status(requirement)).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("Sign in again"),
    })

    expect(access.rejection.value?.message).not.toContain("private")
    expect(accessError(new Error("Connection refused"))).toBeUndefined()
  })

  test("keeps controls unavailable when permission checks fail", async () => {
    const access = createAccessController(async () => {
      throw new Error("Offline")
    })

    access.status({ permission: "project.create" })
    await access.flush()

    expect(access.status({ permission: "project.create" })).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("could not be checked"),
    })
  })

  test("applies pushed grants and disables controls again on live revocation", async () => {
    const access = createAccessController(async checks =>
      checks.map(item => ({ key: item.key, allowed: false })),
    )

    const requirement = { permission: "project.create" as const }
    access.status(requirement)
    await access.flush()
    const key = access.checks.value[0]!.key
    access.apply([{ key, allowed: true }])
    expect(access.status(requirement).allowed).toBe(true)
    access.apply([{ key, allowed: false }])
    expect(access.status(requirement).allowed).toBe(false)
  })
})
