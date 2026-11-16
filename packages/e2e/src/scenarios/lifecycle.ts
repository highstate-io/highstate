import type { Clients } from "../harness/clients"
import type { Effects } from "../harness/effects"
import type { Environment } from "../harness/environment"
import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { join } from "node:path"
import { ComponentKind, InstanceStatus, OperationStatus, OperationType } from "@highstate/api/v1"
import { command } from "../harness/process"
import { waitFor } from "../harness/wait"

export async function runOperation(
  clients: Clients,
  environment: Environment,
  projectId: string,
  instanceIds: string[],
  type: OperationType,
) {
  const { plan } = await clients.operation.planOperation({ projectId, instanceIds, type })
  assert(plan?.token, "Planning must issue a reviewed token")

  const { operation } = await clients.operation.launchOperation({
    projectId,
    instanceIds,
    type,
    planToken: plan.token,
    meta: { title: "Lifecycle E2E" },
  })

  assert(operation)
  await environment.evidence.write(`plan-${operation.id}.json`, plan)

  const result = await waitFor(
    "operation completion",
    async () =>
      (await clients.operation.getOperation({ projectId, operationId: operation.id })).operation!,
    current =>
      [OperationStatus.COMPLETED, OperationStatus.FAILED, OperationStatus.CANCELLED].includes(
        current.status,
      ),
    180_000,
  )

  const { logs } = await clients.operation.listOperationLogs({
    projectId,
    operationId: operation.id,
    pageSize: 1000,
  })

  await environment.evidence.write(`operation-${operation.id}.json`, { operation: result, logs })
  assert.equal(result.status, OperationStatus.COMPLETED, logs.map(log => log.content).join("\n"))
  return result
}

export function argumentsFor(endpoint: string, key: string, value: string) {
  return Object.entries({ endpoint, key, value }).map(([key, value]) => ({
    key,
    value: { kind: { case: "stringValue" as const, value } },
  }))
}

/**
 * Runs packaged code through real image resolution, Pulumi preview, update, refresh, and destroy.
 */
export async function lifecycle(
  clients: Clients,
  environment: Environment,
  effects: Effects,
  projectId: string,
) {
  const { desiredSnapshot } = await clients.library.addLibraryPackage({
    projectId,
    packageName: "@highstate/e2e-library",
    version: "1.0.0",
  })

  assert(desiredSnapshot)
  await environment.evidence.write("snapshot-v1.json", desiredSnapshot)
  const instanceId = "e2e.marker.v1:main"

  await clients.model.createNodes({
    projectId,
    instances: [
      {
        id: instanceId,
        kind: ComponentKind.UNIT,
        type: "e2e.marker.v1",
        name: "main",
        arguments: argumentsFor(effects.url, "main", "first"),
      },
    ],
  })

  await runOperation(clients, environment, projectId, [instanceId], OperationType.PREVIEW)
  assert.equal(effects.resources.size, 0, "Preview must not create external resources")

  let state = (await clients.state.listInstanceStates({ projectId })).states.find(
    state => state.instanceId === instanceId,
  )

  assert.equal(state?.librarySnapshotId, undefined, "Preview must not advance deployed provenance")
  await runOperation(clients, environment, projectId, [instanceId], OperationType.UPDATE)
  assert.equal(effects.resources.get("main")?.marker, "v1")
  assert.equal(effects.resources.get("main")?.value, "first")

  const deployedStates = await clients.state.listInstanceStates({
    projectId,
    includeLastOperationState: true,
    pageSize: 100,
  })

  await environment.evidence.write("deployed-states.json", deployedStates)
  state = deployedStates.states.find(state => state.instanceId === instanceId)
  assert.equal(state?.status, InstanceStatus.DEPLOYED)
  assert.equal(state.librarySnapshotId, desiredSnapshot.id)
  assert(state.libraryPackageVersionId)
  assert.equal(state.lastOperationState?.librarySnapshotId, desiredSnapshot.id)

  // read-only persistence observation cannot create fixture state or bypass a product workflow
  const database = new Database(
    join(environment.directory, ".highstate/projects", projectId, "project.db"),
    { readonly: true },
  )

  try {
    const output = database.query("SELECT content FROM EntitySnapshotContent").all() as {
      content: string
    }[]

    assert(
      output.some(
        row => row.content.includes('"marker":"v1"') && row.content.includes('"value":"first"'),
      ),
      "Unit outputs must persist as entity snapshots",
    )

    await environment.evidence.write("persisted-unit-outputs.json", output)
  } finally {
    database.close()
  }

  const image = (await clients.library.getProjectLibrary({ projectId })).desiredSnapshotImage
  assert(image)
  await environment.evidence.write("image-v1.json", image)
  const beforeRefresh = effects.events.length
  await runOperation(clients, environment, projectId, [instanceId], OperationType.REFRESH)

  assert(
    effects.events
      .slice(beforeRefresh)
      .some(event => event.method === "GET" && event.marker === "v1"),
  )

  await assert.rejects(
    clients.library.addLibraryPackage({
      projectId,
      packageName: "@highstate/e2e-conflicting",
      version: "1.0.0",
    }),
  )

  assert.equal(
    (await clients.library.getProjectLibrary({ projectId })).desiredSnapshot?.id,
    desiredSnapshot.id,
    "Conflicting definitions must leave the selection atomic",
  )

  const compositeId = "e2e.composite.v1:assembled"

  await clients.model.createNodes({
    projectId,
    instances: [
      {
        id: compositeId,
        kind: ComponentKind.COMPOSITE,
        type: "e2e.composite.v1",
        name: "assembled",
        arguments: argumentsFor(effects.url, "composite", "expanded"),
      },
    ],
  })

  const childStates = await waitFor(
    "runtime composite expansion",
    async () =>
      await clients.state.listInstanceStates({
        projectId,
        pageSize: 100,
        includeEvaluationState: true,
        includeParentInstanceId: true,
      }),
    result =>
      result.states.some(
        state =>
          state.instanceId !== instanceId &&
          state.instanceId.startsWith("e2e.marker.v1:") &&
          state.evaluationState,
      ),
    120_000,
  )

  await environment.evidence.write("composite-expansion.json", childStates)

  const child = childStates.states.find(
    state => state.instanceId !== instanceId && state.instanceId.startsWith("e2e.marker.v1:"),
  )

  assert(
    child?.evaluationState?.evaluationActionId,
    "Runtime evaluation must persist its actual action identity",
  )

  await runOperation(clients, environment, projectId, [compositeId], OperationType.UPDATE)
  assert.equal(effects.resources.get("composite")?.marker, "v1")

  const upgraded = await clients.library.updateLibraryPackage({
    projectId,
    packageName: "@highstate/e2e-library",
    version: "2.0.0",
  })

  assert(upgraded.desiredSnapshot)
  assert.notEqual(upgraded.desiredSnapshot.id, desiredSnapshot.id)
  await environment.evidence.write("snapshot-v2.json", upgraded.desiredSnapshot)

  const historicalState = (
    await clients.state.listInstanceStates({ projectId, pageSize: 100 })
  ).states.find(state => state.instanceId === instanceId)

  assert.equal(
    historicalState?.librarySnapshotId,
    desiredSnapshot.id,
    "Selecting v2 must not rewrite deployed v1 provenance",
  )

  assert(image.imageRef)
  await command(["docker", "image", "rm", "-f", image.imageRef])
  const historicalStart = effects.events.length
  await runOperation(clients, environment, projectId, [instanceId], OperationType.REFRESH)

  assert(
    effects.events
      .slice(historicalStart)
      .some(event => event.method === "GET" && event.marker === "v1"),
    "Refresh must rebuild and execute deployed v1 after selecting v2",
  )

  await runOperation(clients, environment, projectId, [instanceId], OperationType.UPDATE)
  assert.equal(effects.resources.get("main")?.marker, "v2")

  const upgradedState = (
    await clients.state.listInstanceStates({ projectId, pageSize: 100 })
  ).states.find(state => state.instanceId === instanceId)

  assert.equal(upgradedState?.librarySnapshotId, upgraded.desiredSnapshot.id)
  await clients.library.removeLibraryPackage({ projectId, packageName: "@highstate/e2e-library" })

  await environment.evidence.write(
    "states-after-package-removal.json",
    await clients.state.listInstanceStates({
      projectId,
      pageSize: 100,
      includeParentInstanceId: true,
      includeEvaluationState: true,
    }),
  )

  await environment.evidence.write("upgrade-history.json", {
    before: historicalState,
    after: upgradedState,
    historicalEffects: effects.events.slice(historicalStart),
  })

  return { instanceId, instanceIds: [instanceId, compositeId], snapshot: desiredSnapshot, image }
}
