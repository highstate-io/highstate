import { createId } from "@paralleldrive/cuid2"
import { describe, expect } from "vitest"
import { adminProjectContext, test } from "../../../test-utils"
import { OperationSettingsService } from "./operation"

describe("OperationSettingsService", () => {
  test("queries and gets operations", async ({ database, project, projectDatabase }) => {
    const service = new OperationSettingsService(database)
    const context = adminProjectContext(project.id)
    await projectDatabase.operation.deleteMany()
    const operation = await projectDatabase.operation.create({
      data: {
        id: createId(),
        type: "update",
        status: "completed",
        meta: { title: "Update operation" },
        options: {},
        requestedInstanceIds: [],
        startedAt: new Date("2023-01-01"),
        updatedAt: new Date("2023-01-01"),
      },
    })

    await expect(service.query(context, { search: "Update" })).resolves.toMatchObject({
      items: [{ id: operation.id }],
    })
    await expect(service.get(context, operation.id)).resolves.toMatchObject({ id: operation.id })
  })
})
