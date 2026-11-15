import assert from "node:assert/strict"
import { join } from "node:path"
import { root, startDesigner } from "../harness/designer"
import { designerCall } from "../harness/designer-client"
import { Evidence } from "../harness/evidence"
import { createFixtureProject } from "../harness/fixtures"
import { inspectDesigner } from "../harness/inspection"

const evidence = new Evidence(
  join(root, ".artifacts/e2e", `api-${new Date().toISOString().replaceAll(":", "-")}`),
)

const designer = await startDesigner()
const projectIds: string[] = []

try {
  const initial = await designerCall<{ items: { id: string }[] }>(
    designer.url,
    "project.getProjects",
    {},
  )

  assert.equal(initial.items.length, 0)
  const projectId = await createFixtureProject(designer.url, "api-project", "API project")
  projectIds.push(projectId)

  const project = await designerCall<{ id: string; name: string }>(
    designer.url,
    "project.getProject",
    { projectId },
  )

  assert.equal(project.id, projectId)
  assert.equal(project.name, "api-project")
  await designerCall(designer.url, "project.getProjectModel", { projectId })
  await designerCall(designer.url, "state.lockProject", { projectId }, true)

  await assert.rejects(
    designerCall(designer.url, "project.getProjectModel", { projectId }),
    /locked/i,
  )

  assert.doesNotMatch(designer.logs(), /library watcher failed/)

  await evidence.write("api-smoke.json", { status: "passed", projectIds })
  console.log("PASS API project creation, lookup, unlocked access, and lock enforcement")
} catch (error) {
  await evidence.write("api-smoke.json", { status: "failed", error: String(error) })
  process.exitCode = 1
  console.error(error)
} finally {
  if (process.env.HIGHSTATE_E2E_KEEP_ALIVE === "1") {
    await inspectDesigner(designer, projectIds)
  }

  await designer.stop()
}
