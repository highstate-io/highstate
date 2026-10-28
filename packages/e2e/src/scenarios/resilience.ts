import type { Clients } from "../harness/clients"
import type { Effects } from "../harness/effects"
import type { Environment } from "../harness/environment"
import assert from "node:assert/strict"
import { OperationStatus, OperationType } from "@highstate/api/v1"
import { waitFor } from "../harness/wait"
import { runOperation } from "./lifecycle"

/** Interrupts actual in-flight Pulumi reads and verifies durable recovery through public APIs. */
export async function resilience(
  clients: Clients,
  environment: Environment,
  effects: Effects,
  projectId: string,
  instanceId: string,
  restart: () => Promise<Clients>,
): Promise<Clients> {
  const before = (await clients.state.listInstanceStates({ projectId, pageSize: 100 })).states.find(
    state => state.instanceId === instanceId,
  )
  assert(before?.librarySnapshotId)
  for (const interruption of ["cancel", "restart"] as const) {
    const eventStart = effects.events.length
    effects.hold("main")
    try {
      const request = { projectId, instanceIds: [instanceId], type: OperationType.REFRESH }
      const { plan } = await clients.operation.planOperation(request)
      assert(plan?.token)
      const { operation } = await clients.operation.launchOperation({
        ...request,
        planToken: plan.token,
        meta: { title: `E2E ${interruption}` },
      })
      assert(operation)
      await waitFor(
        "provider read in flight",
        async () => effects.events.slice(eventStart),
        events => events.some(event => event.key === "main" && event.method === "GET"),
        60_000,
      )
      if (interruption === "cancel") {
        await clients.operation.cancelOperation({ projectId, operationId: operation.id })
      } else {
        clients = await restart()
        await clients.project.unlockProject({ projectId, decryptedIdentity: "" })
      }
      const recovered = await waitFor(
        `${interruption} finalization`,
        async () =>
          (await clients.operation.getOperation({ projectId, operationId: operation.id }))
            .operation!,
        current =>
          [OperationStatus.CANCELLED, OperationStatus.FAILED, OperationStatus.COMPLETED].includes(
            current.status,
          ),
        60_000,
      )
      assert.equal(
        recovered.status,
        interruption === "cancel" ? OperationStatus.CANCELLED : OperationStatus.FAILED,
      )
      const after = (
        await clients.state.listInstanceStates({ projectId, pageSize: 100 })
      ).states.find(state => state.instanceId === instanceId)
      assert.equal(after?.librarySnapshotId, before.librarySnapshotId)
      assert.equal(after?.libraryPackageVersionId, before.libraryPackageVersionId)
      await environment.evidence.write(`${interruption}-recovery.json`, {
        operation: recovered,
        before,
        after,
      })
    } finally {
      effects.release("main")
    }
    // A real subsequent operation must acquire ownership and complete after interruption.
    await runOperation(clients, environment, projectId, [instanceId], OperationType.REFRESH)
  }
  return clients
}
