import { createId } from "@paralleldrive/cuid2"
import { armor, Decrypter, generateIdentity } from "age-encryption"
import { describe, expect, vi } from "vitest"
import { MemoryPubSubBackend, PubSubManager } from "../../../pubsub"
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
  test("notifies live clients only after committed settings changes", async ({
    database,
    logger,
  }) => {
    const pubsub = new PubSubManager(new MemoryPubSubBackend(logger), logger)
    const id = createId()
    const observed: (string | null)[] = []

    const publish = vi.spyOn(pubsub, "publish").mockImplementation(async () => {
      const row = await database.backend.containerRuntime.findUnique({ where: { id } })
      observed.push(row?.revision ?? null)
    })

    const service = new RuntimeSettingsService(
      database,
      await generateIdentity(),
      undefined,
      pubsub,
    )

    const created = await service.put(context, "container-runtime", id, dockerInput)
    expect(publish).toHaveBeenCalledExactlyOnceWith(["runtime-settings"], {})

    await expect(service.put(context, "container-runtime", id, dockerInput)).rejects.toBeInstanceOf(
      RuntimeSettingsConflictError,
    )

    expect(publish).toHaveBeenCalledTimes(1)
    await service.delete(context, "container-runtime", id, created.revision)
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenLastCalledWith(["runtime-settings"], {})
    expect(observed).toEqual([created.revision, null])
  })

  test("persists Docker settings with encrypted secrets, safe outputs, and revision CAS", async ({
    database,
  }) => {
    const identity = await generateIdentity()
    const service = new RuntimeSettingsService(database, identity)
    const id = createId()
    const created = await service.put(context, "container-runtime", id, dockerInput)
    expect(created).toMatchObject({ id, spec: { tls: { clientKeyConfigured: true } } })
    expect(created.revision).toMatch(/^[a-z][a-z0-9]{23}$/)
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
      revision: created.revision,
      spec: { ...dockerInput.spec, tls: undefined },
    }

    const updated = await service.put(context, "container-runtime", id, replacement)
    expect(updated.spec).toMatchObject({ tls: { clientKeyConfigured: true } })
    expect(updated.revision).not.toBe(created.revision)

    const preserved = await database.backend.containerRuntime.findUniqueOrThrow({ where: { id } })
    expect(preserved.spec).toEqual(stored.spec)

    await expect(
      service.delete(context, "container-runtime", id, created.revision),
    ).rejects.toBeInstanceOf(RuntimeSettingsConflictError)

    await service.delete(context, "container-runtime", id, updated.revision)
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
      revision: row.revision,
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
        revision: row.revision,
        spec: { ...input.spec, kubeconfig: null },
      }),
    ).resolves.toMatchObject({ spec: { kubeconfigConfigured: false } })

    row = await database.backend.containerRuntime.findUniqueOrThrow({ where: { id } })
    expect(row.spec).not.toHaveProperty("encryptedKubeconfig")
    await service.delete(context, "container-runtime", id, row.revision)
  })

  test("persists Pulumi state settings without exposing credentials and preserves omitted secrets", async ({
    database,
  }) => {
    const identity = await generateIdentity()
    const service = new RuntimeSettingsService(database, identity)
    const id = createId()

    const input = {
      meta: { title: "State" },
      spec: { url: "s3://state", credentials: "state-secret" },
    }

    const output = await service.put(context, "pulumi-state-backend", id, input)
    expect(output.spec).toEqual({ url: "s3://state", credentialsConfigured: true })
    const stored = await database.backend.pulumiStateBackend.findUniqueOrThrow({ where: { id } })
    expect(await decrypt(identity, stored.spec.encryptedCredentials!)).toBe("state-secret")

    const updated = await service.put(context, "pulumi-state-backend", id, {
      ...input,
      revision: output.revision,
      spec: { url: "s3://new-state" },
    })

    expect(
      (await database.backend.pulumiStateBackend.findUniqueOrThrow({ where: { id } })).spec
        .encryptedCredentials,
    ).toBe(stored.spec.encryptedCredentials)

    await expect(
      service.put(context, "pulumi-state-backend", id, { ...input, revision: output.revision }),
    ).rejects.toBeInstanceOf(RuntimeSettingsConflictError)

    expect(await service.list(context, "pulumi-state-backend")).toContainEqual(
      expect.objectContaining({ id, revision: updated.revision }),
    )

    await service.delete(context, "pulumi-state-backend", id, updated.revision)
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
      scope: `@test-${npmId}/`,
      registryUrl: "https://registry.npmjs.org",
      credentials: { token: "npm-secret-token" },
    }

    const container = {
      meta: { title: "OCI" },
      registryUrl: `${containerId}.example`,
      credentials: { username: "robot", password: "registry-secret" },
    }

    expect(await service.put(context, "npm-registry-credential", npmId, npm)).toMatchObject({
      credentialsConfigured: true,
    })

    expect(
      await service.put(context, "container-registry-credential", containerId, container),
    ).toMatchObject({ credentialsConfigured: true })

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

    const updatedNpm = await service.put(context, "npm-registry-credential", npmId, {
      ...npm,
      revision: npmRow.revision,
      credentials: undefined,
    })

    const updatedContainer = await service.put(
      context,
      "container-registry-credential",
      containerId,
      {
        ...container,
        revision: containerRow.revision,
        credentials: undefined,
      },
    )

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
      service.put(context, "npm-registry-credential", npmId, { ...npm, revision: npmRow.revision }),
    ).rejects.toBeInstanceOf(RuntimeSettingsConflictError)

    await expect(
      service.put(context, "container-registry-credential", containerId, {
        ...container,
        revision: containerRow.revision,
      }),
    ).rejects.toBeInstanceOf(RuntimeSettingsConflictError)

    for (const kind of ["npm-registry-credential", "container-registry-credential"] as const) {
      expect(JSON.stringify(await service.list(context, kind))).not.toContain(
        "encryptedCredentials",
      )
    }

    const runtime = await service.put(context, "container-runtime", runtimeId, {
      ...dockerInput,
      npmRegistryCredentialIds: [npmId],
      containerRegistryCredentialIds: [containerId],
    })

    await expect(
      service.delete(context, "npm-registry-credential", npmId, updatedNpm.revision),
    ).rejects.toBeInstanceOf(RuntimeSettingsInUseError)

    await expect(
      service.delete(
        context,
        "container-registry-credential",
        containerId,
        updatedContainer.revision,
      ),
    ).rejects.toBeInstanceOf(RuntimeSettingsInUseError)

    await service.delete(context, "container-runtime", runtimeId, runtime.revision)

    await expect(
      service.delete(context, "npm-registry-credential", npmId, npmRow.revision),
    ).rejects.toBeInstanceOf(RuntimeSettingsConflictError)

    await expect(
      service.delete(context, "container-registry-credential", containerId, containerRow.revision),
    ).rejects.toBeInstanceOf(RuntimeSettingsConflictError)

    await service.delete(context, "npm-registry-credential", npmId, updatedNpm.revision)
    await service.delete(
      context,
      "container-registry-credential",
      containerId,
      updatedContainer.revision,
    )
  })

  test("denies unauthorized mutation and filters resource-restricted lists", async ({
    database,
  }) => {
    const service = new RuntimeSettingsService(database, await generateIdentity())

    const id = createId(),
      otherId = createId()

    const created = await service.put(context, "container-runtime", id, dockerInput)
    const other = await service.put(context, "container-runtime", otherId, dockerInput)
    const denied = createBackendRequestContext()

    await expect(
      service.put(denied, "container-runtime", id, { ...dockerInput, revision: created.revision }),
    ).rejects.toThrow()

    await expect(
      service.delete(denied, "container-runtime", id, created.revision),
    ).rejects.toThrow()
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
      service.put(manager, "container-runtime", otherId, {
        ...dockerInput,
        revision: other.revision,
      }),
    ).rejects.toThrow()

    await expect(
      service.put(manager, "container-runtime", id, {
        ...dockerInput,
        revision: created.revision,
        npmRegistryCredentialIds: ["inaccessible"],
      }),
    ).rejects.toThrow()

    expect(
      (await database.backend.containerRuntime.findUniqueOrThrow({ where: { id } })).revision,
    ).toBe(created.revision)

    await service.delete(context, "container-runtime", id, created.revision)
    await service.delete(context, "container-runtime", otherId, other.revision)
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
      service.put(context, "container-runtime", id, { ...dockerInput, revision: "invalid" }),
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
        spec: { url: "https://user:secret@example.com" },
      }),
    ).rejects.toThrow()

    await expect(
      service.put(context, "npm-registry-credential", id, {
        meta: { title: "Missing" },
        scope: "",
        registryUrl: "https://registry.npmjs.org",
      }),
    ).rejects.toThrow()

    const created = await service.put(context, "container-runtime", id, dockerInput)

    await expect(
      service.put(context, "container-runtime", id, {
        ...dockerInput,
        revision: created.revision,
        npmRegistryCredentialIds: [createId()],
      }),
    ).rejects.toThrow()

    expect(
      (await database.backend.containerRuntime.findUniqueOrThrow({ where: { id } })).revision,
    ).toBe(created.revision)

    await service.delete(context, "container-runtime", id, created.revision)
  })

  test("blocks deletion of project-referenced settings and runtimes with real workloads", async ({
    database,
    createProject,
  }) => {
    const service = new RuntimeSettingsService(database, await generateIdentity())

    const runtimeId = createId(),
      stateId = createId()

    const runtime = await service.put(context, "container-runtime", runtimeId, dockerInput)

    const state = await service.put(context, "pulumi-state-backend", stateId, {
      meta: { title: "Referenced" },
      spec: { url: "s3://state" },
    })

    const project = await createProject(`references-${createId()}`, {
      containerRuntimeId: runtimeId,
      pulumiStateBackendId: stateId,
    })

    await expect(
      service.delete(context, "container-runtime", runtimeId, runtime.revision),
    ).rejects.toBeInstanceOf(RuntimeSettingsInUseError)

    await expect(
      service.delete(context, "pulumi-state-backend", stateId, state.revision),
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

    await expect(
      service.delete(context, "container-runtime", runtimeId, runtime.revision),
    ).rejects.toBeInstanceOf(RuntimeSettingsInUseError)

    await database.backend.runtimeWorkload.update({
      where: { id: workload.id },
      data: { status: "completed", desiredState: "deleted", cleanedUpAt: new Date() },
    })

    await expect(
      service.delete(context, "container-runtime", runtimeId, runtime.revision),
    ).rejects.toBeInstanceOf(RuntimeSettingsInUseError)

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

    await expect(
      service.delete(context, "container-runtime", runtimeId, runtime.revision),
    ).rejects.toBeInstanceOf(RuntimeSettingsInUseError)

    await database.backend.librarySnapshotImage.delete({ where: { id: image.id } })
    await service.delete(context, "container-runtime", runtimeId, runtime.revision)
    await service.delete(context, "pulumi-state-backend", stateId, state.revision)
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
    const created = await service.put(context, "container-runtime", id, dockerInput)
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

    await service.delete(context, "container-runtime", id, created.revision)
  })

  test("validates new role resource references and lists authorized restriction options", async ({
    database,
  }) => {
    const service = new RuntimeSettingsService(database, await generateIdentity())
    const roles = new BackendRoleSettingsService(database)
    const id = createId()
    const created = await service.put(context, "container-runtime", id, dockerInput)

    const stateId = createId(),
      npmId = createId(),
      containerId = createId()

    await service.put(context, "pulumi-state-backend", stateId, {
      meta: { title: "State reference" },
      spec: { url: "s3://state" },
    })

    await service.put(context, "npm-registry-credential", npmId, {
      meta: { title: "Npm reference" },
      scope: `@role-${npmId}/`,
      registryUrl: "https://registry.npmjs.org",
      credentials: { token: "reference-token" },
    })

    await service.put(context, "container-registry-credential", containerId, {
      meta: { title: "OCI reference" },
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

      const resource = (await service.list(context, kind)).find(row => row.id === resourceId)!
      await service.delete(context, kind, resourceId, resource.revision)
    }

    expect(options.resources).not.toHaveProperty("library")
    expect(options.resources).not.toHaveProperty("pulumi-backend")
    await service.delete(context, "container-runtime", id, created.revision)
  })
})
