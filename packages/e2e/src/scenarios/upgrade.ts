import type { Environment } from "../harness/environment"
import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startBackend } from "../harness/backend"
import { createClients } from "../harness/clients"
import { cleanupProjectResources } from "../harness/environment"
import { command } from "../harness/process"

/** Populates real databases with the published pre-redesign backend, then opens them with current startup. */
export async function upgrade(environment: Environment): Promise<void> {
  const directory = join(environment.directory, "upgrade")
  await mkdir(directory)
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "highstate-previous-release-fixture",
      private: true,
      type: "module",
      dependencies: { "@highstate/backend": "1.1.0" },
    }),
  )
  await command(["bun", "install", "--ignore-scripts"], {
    cwd: directory,
    evidence: environment.evidence,
    name: "previous-release-install.log",
  })
  const packagePath = join(directory, "node_modules/@highstate/backend")
  const previousManifest = JSON.parse(
    await readFile(join(packagePath, "package.json"), "utf8"),
  ) as { version: string }
  assert.equal(previousManifest.version, "1.1.0")
  await cp(
    join(environment.root, "packages/e2e/fixtures/upgrade/populate.ts"),
    join(directory, "populate.ts"),
  )
  await command(["bun", join(directory, "populate.ts")], {
    cwd: directory,
    env: {
      PATH: process.env.PATH,
      HOME: directory,
      HIGHSTATE_CODEBASE_PATH: directory,
      HIGHSTATE_ENCRYPTION_ENABLED: "false",
      HIGHSTATE_E2E_PREVIOUS_BACKEND: join(packagePath, "dist/index.js"),
      HIGHSTATE_E2E_PREVIOUS_SHARED: join(packagePath, "dist/shared/index.js"),
      HIGHSTATE_LIBRARY_BACKEND_LOCAL_WORKSPACE_PATH: directory,
      HIGHSTATE_LIBRARY_BACKEND_LOCAL_LIBRARY_PACKAGES: "@highstate/contract",
      HIGHSTATE_LIBRARY_BACKEND_LOCAL_BUILD_ON_STARTUP: "false",
      HIGHSTATE_LIBRARY_BACKEND_LOCAL_BUILD_ON_CHANGES: "false",
    },
    evidence: environment.evidence,
    name: "previous-release-populate.log",
  })
  const previous = JSON.parse(await readFile(join(directory, "previous.json"), "utf8")) as {
    projectId: string
    instanceId: string
    stateId: string
    databaseVersion: number
  }
  const projectPath = join(directory, ".highstate/projects", previous.projectId, "project.db")
  environment.cleanup.add(async () => {
    await cleanupProjectResources(previous.projectId, environment.evidence)
  })
  const old = new Database(projectPath, { readonly: true })
  assert.equal(
    old.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM InstanceState").get()?.count,
    1,
  )
  assert.equal(
    old
      .query("PRAGMA table_info(InstanceState)")
      .all()
      .some(column => (column as { name: string }).name === "librarySnapshotId"),
    false,
  )
  old.close()
  for (const file of ["cert.pem", "key.pem"])
    await cp(join(environment.directory, file), join(directory, file))
  const backend = await startBackend({ ...environment, directory, logName: "upgraded-backend.log" })
  try {
    const clients = createClients(backend.url, backend.token)
    const { runtimes } = await clients.runtime.listContainerRuntimes({})
    const runtime = runtimes.find(runtime => runtime.id === "local")
    assert(runtime)
    await clients.runtime.putContainerRuntime({
      expectedRevision: runtime.revision,
      runtime: {
        id: runtime.id,
        meta: { title: "Upgraded local Docker" },
        npmRegistryCredentialIds: runtime.npmRegistryCredentialIds,
        spec: {
          runtime: {
            case: "docker",
            value: { local: true, engineEndpoint: "unix:///var/run/docker.sock" },
          },
          runtimeApiUrl: `https://host.docker.internal:${environment.runtimePort}`,
          runtimeApiCaBundle: Buffer.from(environment.cert),
        },
      },
    })
    await clients.project.unlockProject({ projectId: previous.projectId, decryptedIdentity: "" })
    const { project } = await clients.project.getProject({ projectId: previous.projectId })
    assert.equal(project?.meta?.title, "Populated before upgrade")
    // Normal project database access performs pending migrations; no migration SQL is injected.
    const states = await clients.state.listInstanceStates({
      projectId: previous.projectId,
      pageSize: 100,
    })
    const state = states.states.find(state => state.id === previous.stateId)
    assert.equal(state?.instanceId, previous.instanceId)
    assert.equal(state.librarySnapshotId, undefined)
    assert.equal(state.libraryPackageVersionId, undefined)
    const database = new Database(projectPath, { readonly: true })
    try {
      assert.deepEqual(database.query("PRAGMA foreign_key_check").all(), [])
      assert.equal(
        database.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM Secret").get()?.count,
        1,
      )
      assert.equal(
        database
          .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM ServiceAccountRoleBinding")
          .get()?.count,
        1,
      )
    } finally {
      database.close()
    }
    await environment.evidence.write("populated-release-upgrade.json", {
      previousRelease: "@highstate/backend@1.1.0",
      previous,
      project,
      states,
      foreignKeyViolations: [],
      secretsPreserved: true,
      authorizationBindingsPreserved: true,
    })
  } finally {
    await backend.stop()
  }
}
