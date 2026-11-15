import { startDesigner } from "./harness/designer"
import { createFixtureProject } from "./harness/fixtures"
import { inspectDesigner } from "./harness/inspection"

const mode = process.env.HIGHSTATE_E2E_MODE ?? "development"
if (mode !== "development" && mode !== "production") {
  throw new Error("HIGHSTATE_E2E_MODE must be development or production")
}
const designer = await startDesigner({ mode })
try {
  const first = await createFixtureProject(
    designer.url,
    "inspection-primary",
    "Primary inspection project",
  )

  const second = await createFixtureProject(
    designer.url,
    "inspection-secondary",
    "Secondary inspection project",
  )

  await inspectDesigner(designer, [first, second])
} finally {
  await designer.stop()
}
