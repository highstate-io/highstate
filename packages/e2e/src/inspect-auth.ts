import { startHostedDesigner } from "./harness/hosted"
import { inspectDesigner } from "./harness/inspection"

const designer = await startHostedDesigner()

try {
  console.log("Local OIDC identities: E2E Administrator, E2E Reader, E2E Outsider")
  await inspectDesigner(designer)
} finally {
  await designer.stop()
}
