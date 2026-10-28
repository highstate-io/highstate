import type { Clients } from "./clients"
import type { Environment } from "./environment"
import assert from "node:assert/strict"
import { generateIdentity, identityToRecipient } from "age-encryption"

/** Configures placement and creates an unlocked project through the public API. */
export async function createProject(
  clients: Clients,
  environment: Environment,
  registryUrl: string,
): Promise<string> {
  const { credential } = await clients.runtime.putNpmRegistryCredential({
    credential: {
      meta: { title: "E2E npm fixture" },
      registryUrl,
      scope: "@highstate/",
      credentials: Buffer.from(JSON.stringify({ token: "isolated-e2e-registry" })),
    },
  })
  assert(credential)
  const { runtime } = await clients.runtime.putContainerRuntime({
    expectedRevision: (await clients.runtime.listContainerRuntimes({})).runtimes.find(
      runtime => runtime.id === "local",
    )!.revision,
    runtime: {
      id: "local",
      meta: { title: "E2E local Docker" },
      spec: {
        runtime: {
          case: "docker",
          value: { local: true, engineEndpoint: "unix:///var/run/docker.sock" },
        },
        runtimeApiUrl: `https://host.docker.internal:${environment.runtimePort}`,
        runtimeApiCaBundle: Buffer.from(environment.cert),
      },
      npmRegistryCredentialIds: [credential.id],
    },
  })
  assert(runtime)
  const identity = await generateIdentity()
  environment.evidence.redact(identity)
  const { project } = await clients.project.createProject(
    {
      projectId: environment.projectId,
      project: {
        name: `e2e-${environment.runId.toLowerCase()}`,
        meta: { title: "Disposable lifecycle E2E" },
        modelStorageId: "rmi0hmo1tjjsyfry9l178fus",
        containerRuntimeId: "local",
        pulumiStateBackendId: "local",
      },
      unlockMethod: {
        type: "password",
        meta: { title: "E2E" },
        recipient: await identityToRecipient(identity),
        encryptedIdentity: "isolated-unencrypted-test",
      },
    },
    { timeoutMs: 30_000 },
  )
  assert(project)
  assert.equal((await clients.project.getProject({ projectId: project.id })).isLocked, false)
  await clients.library.setLocalLibraryOverlay({ projectId: project.id, enabled: false })
  return project.id
}
