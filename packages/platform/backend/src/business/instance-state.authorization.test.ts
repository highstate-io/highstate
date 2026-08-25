import type { InstanceId } from "@highstate/contract"
import pino from "pino"
import { describe, expect, vi } from "vitest"
import { PermissionDeniedError } from "../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../test-utils"
import { InstanceStateService } from "./instance-state"

describe("InstanceStateService authorization", () => {
  test("requires instance-status.update and a matching instance restriction", async ({
    database,
    project,
    projectDatabase,
    createInstanceState,
  }) => {
    const service = new InstanceStateService(
      database,
      { publish: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      vi.mockObject({ track: vi.fn() } as never),
      pino({ level: "silent" }),
    )
    const state = await createInstanceState(project.id)
    const account = await projectDatabase.serviceAccount.create({
      data: { meta: { title: "Account" } },
    })
    const subject = { type: "service-account" as const, serviceAccountId: account.id }
    const status = { name: "health", meta: { title: "Health" }, value: "ok" }

    await expect(
      service.updateCustomStatus(
        createProjectRequestContext(project.id, undefined, subject),
        state.id,
        account.id,
        status,
      ),
    ).rejects.toThrow(PermissionDeniedError)

    await expect(
      service.updateCustomStatus(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("instance-status.update", [
            { type: "instances", instanceIds: ["server.v1:other"], recursive: false },
          ]),
          subject,
        ),
        state.id,
        account.id,
        status,
      ),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.updateCustomStatus(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("instance-status.update", [
            { type: "instances", instanceIds: [state.instanceId as InstanceId], recursive: false },
          ]),
          subject,
        ),
        state.id,
        account.id,
        status,
      ),
    ).resolves.toBeUndefined()
  })
})
