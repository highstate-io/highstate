import { createId } from "@paralleldrive/cuid2"
import { armor, Decrypter, generateIdentity } from "age-encryption"
import { describe, expect, vi } from "vitest"
import {
  type ContainerRuntimeInput,
  RuntimeSettingsConflictError,
  RuntimeSettingsInUseError,
} from "../../../shared/models/backend/runtime-settings"
import {
  adminBackendContext,
  createBackendRequestContext,
  grantBackendPermission,
  test,
} from "../../../test-utils"
import { BackendRoleSettingsService } from "./role"
import { RuntimeSettingsService } from "./runtime"

const context = adminBackendContext()
const dockerInput = {
  meta: { title: "Docker" },
  revision: 0,
  spec: {
    type: "docker",
    runtimeApiUrl: "https://runtime.example",
    engineEndpoint: "unix:///var/run/docker.sock",
    local: true,
    tls: { clientKey: "docker-private-key" },
  },
} satisfies ContainerRuntimeInput

async function decrypt(identity: string, ciphertext: string) {
  const decrypter = new Decrypter()
  decrypter.addIdentity(identity)
  return await decrypter.decrypt(armor.decode(ciphertext), "text")
}

describe("RuntimeSettingsService", () => {
  test("persists Docker settings with encrypted secrets, safe outputs, and revision CAS", async ({
    database,
  }) => {
    const identity = await generateIdentity()
    const service = new RuntimeSettingsService(database, identity)
    const id = createId()
    const created = await service.put(context, "container-runtime", id, dockerInput)
    expect(created).toMatchObject({ id, revision: 1, spec: { tls: { clientKeyConfigured: true } } })
    expect(JSON.stringify(created)).not.toContain("docker-private-key")
    expect(JSON.stringify(created)).not.toContain("encryptedClientKey")
    const stored = await database.backend.containerRuntime.findUniqueOrThrow({ where: { id } })
    if (stored.spec.type !== "docker") {
      throw new Error("Expected Docker")
    }

    expect(stored.spec.tls?.encryptedClientKey).toContain("BEGIN AGE ENCRYPTED FILE")
    expect(await decrypt(identity, stored.spec.tls!.encryptedClientKey!)).toBe("docker-private-key")

    await expect(
      decrypt(await generateIdentity(), stored.spec.tls!.encryptedClientKey!),
    ).rejects.toThrow()

    await expect(service.put(context, "container-runtime", id, dockerInput)).rejects.toBeInstanceOf(
      RuntimeSettingsConflictError,
    )

    const replacement = {
      ...dockerInput,
      revision: 1,
      spec: { ...dockerInput.spec, tls: undefined },
    }

    await expect(service.put(context, "container-runtime", id, replacement)).resolves.toMatchObject(
      { revision: 2, spec: { tls: { clientKeyConfigured: true } } },
    )

    const preserved = await database.backend.containerRuntime.findUniqueOrThrow({ where: { id } })
    expect(preserved.spec).toEqual(stored.spec)

    await expect(service.delete(context, "container-runtime", id, 1)).rejects.toBeInstanceOf(
      RuntimeSettingsConflictError,
    )

    await service.delete(context, "container-runtime", id, 2)
    expect(await database.backend.containerRuntime.findUnique({ where: { id } })).toBeNull()
  })

  test("encrypts, preserves, rotates, and explicitly clears Kubernetes credentials", async ({
    database,
  }) => {
    const identity = await generateIdentity()
    const service = new RuntimeSettingsService(database, identity)
    const id = createId()

    const input = {
      meta: { title: "Kubernetes" },
      revision: 0,
      spec: {
        type: "kubernetes",
        runtimeApiUrl: "https://runtime.example",
        namespace: "highstate",
        serviceAccount: "runner",
        buildkitImage: "moby/buildkit:latest",
        imageRepository: "ghcr.io/example/library",
        kubeconfig: "private-kubeconfig",
      },
    } satisfies ContainerRuntimeInput

    await service.put(context, "container-runtime", id, input)
    let row = await database.backend.containerRuntime.findUniqueOrThrow({ where: { id } })
    if (row.spec.type !== "kubernetes") {
      throw new Error("Expected Kubernetes")
    }

    expect(await decrypt(identity, row.spec.encryptedKubeconfig!)).toBe("private-kubeconfig")

    await service.put(context, "container-runtime", id, {
      ...input,
      revision: 1,
      spec: { ...input.spec, kubeconfig: "rotated-kubeconfig" },
    })

    row = await database.backend.containerRuntime.findUniqueOrThrow({ where: { id } })

    if (row.spec.type !== "kubernetes") {
      throw new Error("Expected Kubernetes")
    }

    expect(await decrypt(identity, row.spec.encryptedKubeconfig!)).toBe("rotated-kubeconfig")

    await expect(
      service.put(context, "container-runtime", id, {
        ...input,
        revision: 2,
        spec: { ...input.spec, kubeconfig: null },
      }),
    ).resolves.toMatchObject({ spec: { kubeconfigConfigured: false } })

    row = await database.backend.containerRuntime.findUniqueOrThrow({ where: { id } })
    expect(row.spec).not.toHaveProperty("encryptedKubeconfig")
    await service.delete(context, "container-runtime", id, 3)
  })

  test("persists Pulumi state settings without exposing credentials and preserves omitted secrets", async ({
    database,
  }) => {
    const identity = await generateIdentity()
    const service = new RuntimeSettingsService(database, identity)
    const id = createId()

    const input = {
      meta: { title: "State" },
      revision: 0,
      spec: { url: "s3://state", credentials: "state-secret" },
    }

    const output = await service.put(context, "pulumi-state-backend", id, input)
    expect(output.spec).toEqual({ url: "s3://state", credentialsConfigured: true })
    const stored = await database.backend.pulumiStateBackend.findUniqueOrThrow({ where: { id } })
    expect(await decrypt(identity, stored.spec.encryptedCredentials!)).toBe("state-secret")

    await service.put(context, "pulumi-state-backend", id, {
      ...input,
      revision: 1,
      spec: { url: "s3://new-state" },
    })

    expect(
      (await database.backend.pulumiStateBackend.findUniqueOrThrow({ where: { id } })).spec
        .encryptedCredentials,
    ).toBe(stored.spec.encryptedCredentials)

    await expect(
      service.put(context, "pulumi-state-backend", id, { ...input, revision: 1 }),
    ).rejects.toBeInstanceOf(RuntimeSettingsConflictError)

    expect(await service.list(context, "pulumi-state-backend")).toContainEqual(
      expect.objectContaining({ id, revision: 2 }),
    )

    await service.delete(context, "pulumi-state-backend", id, 2)
  })

  test("stores both registry credential kinds encrypted and enforces relation delete restrictions", async ({
    database,
  }) => {
    const identity = await generateIdentity()
    const service = new RuntimeSettingsService(database, identity)

    const npmId = createId(),
      containerId = createId(),
      runtimeId = createId()

    const npm = {
      meta: { title: "Npm" },
      revision: 0,
      scope: `@test-${npmId}/`,
      registryUrl: "https://registry.npmjs.org",
      credentials: { token: "npm-secret-token" },
    }

    const container = {
      meta: { title: "OCI" },
      revision: 0,
      registryUrl: `${containerId}.example`,
      credentials: { username: "robot", password: "registry-secret" },
    }

    expect(await service.put(context, "npm-registry-credential", npmId, npm)).toMatchObject({
      revision: 1,
      credentialsConfigured: true,
    })

    expect(
      await service.put(context, "container-registry-credential", containerId, container),
    ).toMatchObject({ revision: 1, credentialsConfigured: true })

    const npmRow = await database.backend.npmRegistryCredential.findUniqueOrThrow({
      where: { id: npmId },
    })

    const containerRow = await database.backend.containerRegistryCredential.findUniqueOrThrow({
      where: { id: containerId },
    })

    expect(JSON.parse(await decrypt(identity, npmRow.encryptedCredentials))).toEqual(
      npm.credentials,
    )

    expect(JSON.parse(await decrypt(identity, containerRow.encryptedCredentials))).toEqual(
      container.credentials,
    )

    await service.put(context, "npm-registry-credential", npmId, {
      ...npm,
      revision: 1,
      credentials: undefined,
    })

    await service.put(context, "container-registry-credential", containerId, {
      ...container,
      revision: 1,
      credentials: undefined,
    })

    expect(
      (await database.backend.npmRegistryCredential.findUniqueOrThrow({ where: { id: npmId } }))
        .encryptedCredentials,
    ).toBe(npmRow.encryptedCredentials)

    expect(
      (
        await database.backend.containerRegistryCredential.findUniqueOrThrow({
          where: { id: containerId },
        })
      ).encryptedCredentials,
    ).toBe(containerRow.encryptedCredentials)

    await expect(
      service.put(context, "npm-registry-credential", npmId, { ...npm, revision: 1 }),
    ).rejects.toBeInstanceOf(RuntimeSettingsConflictError)

    await expect(
      service.put(context, "container-registry-credential", containerId, {
        ...container,
        revision: 1,
      }),
    ).rejects.toBeInstanceOf(RuntimeSettingsConflictError)

    for (const kind of ["npm-registry-credential", "container-registry-credential"] as const) {
      expect(JSON.stringify(await service.list(context, kind))).not.toContain(
        "encryptedCredentials",
      )
    }

    await service.put(context, "container-runtime", runtimeId, {
      ...dockerInput,
      npmRegistryCredentialIds: [npmId],
      containerRegistryCredentialIds: [containerId],
    })

    await expect(
      service.delete(context, "npm-registry-credential", npmId, 2),
    ).rejects.toBeInstanceOf(RuntimeSettingsInUseError)

    await expect(
      service.delete(context, "container-registry-credential", containerId, 2),
    ).rejects.toBeInstanceOf(RuntimeSettingsInUseError)

    await service.delete(context, "container-runtime", runtimeId, 1)

    await expect(
      service.delete(context, "npm-registry-credential", npmId, 1),
    ).rejects.toBeInstanceOf(RuntimeSettingsConflictError)

    await expect(
      service.delete(context, "container-registry-credential", containerId, 1),
    ).rejects.toBeInstanceOf(RuntimeSettingsConflictError)

    await service.delete(context, "npm-registry-credential", npmId, 2)
    await service.delete(context, "container-registry-credential", containerId, 2)
  })

  test("denies unauthorized mutation and filters resource-restricted lists", async ({
    database,
  }) => {
    const service = new RuntimeSettingsService(database, await generateIdentity())

    const id = createId(),
      otherId = createId()

    await service.put(context, "container-runtime", id, dockerInput)
    await service.put(context, "container-runtime", otherId, dockerInput)
    const denied = createBackendRequestContext()

    await expect(
      service.put(denied, "container-runtime", id, { ...dockerInput, revision: 1 }),
    ).rejects.toThrow()

    await expect(service.delete(denied, "container-runtime", id, 1)).rejects.toThrow()
    await expect(service.preflight(denied, id)).rejects.toThrow()
    await expect(service.list(denied, "container-runtime")).rejects.toThrow()

    const restricted = createBackendRequestContext(
      grantBackendPermission("container-runtime.list", [{ type: "resources", resourceIds: [id] }]),
    )

    expect((await service.list(restricted, "container-runtime")).map(row => row.id)).toEqual([id])

    const manager = createBackendRequestContext(
      grantBackendPermission("container-runtime.manage", [
        { type: "resources", resourceIds: [id] },
      ]),
    )

    await expect(
      service.put(manager, "container-runtime", otherId, { ...dockerInput, revision: 1 }),
    ).rejects.toThrow()

    await expect(
      service.put(manager, "container-runtime", id, {
        ...dockerInput,
        revision: 1,
        npmRegistryCredentialIds: ["inaccessible"],
      }),
    ).rejects.toThrow()

    expect(
      (await database.backend.containerRuntime.findUniqueOrThrow({ where: { id } })).revision,
    ).toBe(1)

    await service.delete(context, "container-runtime", id, 1)
    await service.delete(context, "container-runtime", otherId, 1)
  })

  test("rejects malformed DTOs and rolls back failed relation updates", async ({ database }) => {
    const service = new RuntimeSettingsService(database, await generateIdentity())
    const id = createId()

    await expect(
      service.put(context, "container-runtime", id, {
        ...dockerInput,
        spec: { ...dockerInput.spec, runtimeApiUrl: "http://runtime.example" },
      }),
    ).rejects.toThrow("HTTPS")

    await expect(
      service.put(context, "container-runtime", id, {
        ...dockerInput,
        spec: { ...dockerInput.spec, local: false },
      }),
    ).rejects.toThrow("OCI image repository")

    await expect(
      service.put(context, "container-runtime", id, { ...dockerInput, revision: -1 }),
    ).rejects.toThrow()

    await expect(
      service.put(context, "container-runtime", id, {
        ...dockerInput,
        spec: { ...dockerInput.spec, encryptedClientKey: "plaintext" },
      } as never),
    ).rejects.toThrow()

    await expect(
      service.put(context, "pulumi-state-backend", id, {
        meta: { title: "Invalid" },
        revision: 0,
        spec: { url: "https://user:secret@example.com" },
      }),
    ).rejects.toThrow()

    await expect(
      service.put(context, "npm-registry-credential", id, {
        meta: { title: "Missing" },
        revision: 0,
        scope: "",
        registryUrl: "https://registry.npmjs.org",
      }),
    ).rejects.toThrow()

    await service.put(context, "container-runtime", id, dockerInput)

    await expect(
      service.put(context, "container-runtime", id, {
        ...dockerInput,
        revision: 1,
        npmRegistryCredentialIds: [createId()],
      }),
    ).rejects.toThrow()

    expect(
      (await database.backend.containerRuntime.findUniqueOrThrow({ where: { id } })).revision,
    ).toBe(1)

    await service.delete(context, "container-runtime", id, 1)
  })

  test("blocks deletion of project-referenced settings and runtimes with real workloads", async ({
    database,
    createProject,
  }) => {
    const service = new RuntimeSettingsService(database, await generateIdentity())

    const runtimeId = createId(),
      stateId = createId()

    await service.put(context, "container-runtime", runtimeId, dockerInput)

    await service.put(context, "pulumi-state-backend", stateId, {
      meta: { title: "Referenced" },
      revision: 0,
      spec: { url: "s3://state" },
    })

    const project = await createProject(`references-${createId()}`, {
      containerRuntimeId: runtimeId,
      pulumiStateBackendId: stateId,
    })

    await expect(service.delete(context, "container-runtime", runtimeId, 1)).rejects.toBeInstanceOf(
      RuntimeSettingsInUseError,
    )

    await expect(
      service.delete(context, "pulumi-state-backend", stateId, 1),
    ).rejects.toBeInstanceOf(RuntimeSettingsInUseError)

    const otherProject = await createProject(`workload-${createId()}`)
    await database.backend.project.delete({ where: { id: project.id } })

    const workload = await database.backend.runtimeWorkload.create({
      data: {
        runtimeId,
        projectId: otherProject.id,
        kind: "terminal",
        ownerId: "terminal",
        status: "running",
      },
    })

    await expect(service.delete(context, "container-runtime", runtimeId, 1)).rejects.toBeInstanceOf(
      RuntimeSettingsInUseError,
    )

    await database.backend.runtimeWorkload.update({
      where: { id: workload.id },
      data: { status: "completed", desiredState: "deleted", cleanedUpAt: new Date() },
    })

    await expect(service.delete(context, "container-runtime", runtimeId, 1)).rejects.toBeInstanceOf(
      RuntimeSettingsInUseError,
    )

    await database.backend.runtimeWorkload.delete({ where: { id: workload.id } })

    const image = await database.backend.librarySnapshotImage.create({
      data: {
        runtimeId,
        projectId: otherProject.id,
        snapshotId: createId(),
        snapshotHash: "snapshot-hash",
        status: "ready",
      },
    })

    await expect(service.delete(context, "container-runtime", runtimeId, 1)).rejects.toBeInstanceOf(
      RuntimeSettingsInUseError,
    )

    await database.backend.librarySnapshotImage.delete({ where: { id: image.id } })
    await service.delete(context, "container-runtime", runtimeId, 1)
    await service.delete(context, "pulumi-state-backend", stateId, 1)
  })

  test("delegates preflight and propagates adapter failures instead of reporting success", async ({
    database,
  }) => {
    const identity = await generateIdentity()
    const id = createId()

    const preflight = vi
      .fn()
      .mockResolvedValue([{ name: "engine", ok: false, detail: "unreachable" }])

    const get = vi.fn().mockResolvedValue({ preflight })
    const service = new RuntimeSettingsService(database, identity, { get })
    await service.put(context, "container-runtime", id, dockerInput)
    const signal = new AbortController().signal

    expect(await service.preflight(context, id, signal)).toEqual([
      { name: "engine", ok: false, detail: "unreachable" },
    ])

    expect(get).toHaveBeenCalledWith(id)
    expect(preflight).toHaveBeenCalledWith(signal)
    const failure = new Error("Adapter unavailable")
    preflight.mockRejectedValue(failure)
    await expect(service.preflight(context, id)).rejects.toBe(failure)

    await expect(
      new RuntimeSettingsService(database, identity).preflight(context, id),
    ).rejects.toThrow("provider is not configured")

    await service.delete(context, "container-runtime", id, 1)
  })

  test("validates new role resource references and lists authorized restriction options", async ({
    database,
  }) => {
    const service = new RuntimeSettingsService(database, await generateIdentity())
    const roles = new BackendRoleSettingsService(database)
    const id = createId()
    await service.put(context, "container-runtime", id, dockerInput)

    const stateId = createId(),
      npmId = createId(),
      containerId = createId()

    await service.put(context, "pulumi-state-backend", stateId, {
      meta: { title: "State reference" },
      revision: 0,
      spec: { url: "s3://state" },
    })

    await service.put(context, "npm-registry-credential", npmId, {
      meta: { title: "Npm reference" },
      revision: 0,
      scope: `@role-${npmId}/`,
      registryUrl: "https://registry.npmjs.org",
      credentials: { token: "reference-token" },
    })

    await service.put(context, "container-registry-credential", containerId, {
      meta: { title: "OCI reference" },
      revision: 0,
      registryUrl: `${containerId}.example`,
      credentials: { username: "robot", password: "reference-password" },
    })

    await expect(
      roles.validateReferences({
        rules: [
          {
            permissions: ["container-runtime.get"],
            restrictions: [{ type: "resources", resourceIds: [id] }],
          },
        ],
      }),
    ).resolves.toBeUndefined()

    await expect(
      roles.validateReferences({
        rules: [
          {
            permissions: ["container-runtime.get"],
            restrictions: [{ type: "resources", resourceIds: [createId()] }],
          },
        ],
      }),
    ).rejects.toThrow()

    const options = await roles.getRestrictionOptions(context)
    expect(options.resources["container-runtime"]).toContainEqual(expect.objectContaining({ id }))

    for (const [kind, resourceId] of [
      ["pulumi-state-backend", stateId],
      ["npm-registry-credential", npmId],
      ["container-registry-credential", containerId],
    ] as const) {
      expect(options.resources[kind]).toContainEqual(expect.objectContaining({ id: resourceId }))

      await expect(
        roles.validateReferences({
          rules: [
            {
              permissions: [`${kind}.get`],
              restrictions: [{ type: "resources", resourceIds: [resourceId] }],
            },
          ],
        }),
      ).resolves.toBeUndefined()

      await expect(
        roles.validateReferences({
          rules: [
            {
              permissions: [`${kind}.get`],
              restrictions: [{ type: "resources", resourceIds: [createId()] }],
            },
          ],
        }),
      ).rejects.toThrow()

      await service.delete(context, kind, resourceId, 1)
    }

    expect(options.resources).not.toHaveProperty("library")
    expect(options.resources).not.toHaveProperty("pulumi-backend")
    await service.delete(context, "container-runtime", id, 1)
  })
})
