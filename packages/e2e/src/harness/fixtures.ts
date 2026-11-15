import { createId } from "@paralleldrive/cuid2"
import { generateIdentity, identityToRecipient } from "age-encryption"
import { designerCall } from "./designer-client"

/**
 * Creates an unlocked project using the same trunk Designer API as the browser.
 */
export async function createFixtureProject(
  url: string,
  name: string,
  title: string,
): Promise<string> {
  const projectId = createId()
  const identity = await generateIdentity()

  await designerCall(
    url,
    "project.createProject",
    {
      projectId,
      projectInput: { name, meta: { title } },
      unlockMethodInput: {
        type: "password",
        meta: { title: "Disposable harness fixture" },
        recipient: await identityToRecipient(identity),
        encryptedIdentity: "isolated-unencrypted-fixture",
      },
    },
    true,
  )

  await designerCall(url, "state.unlockProject", { projectId, decryptedIdentity: identity }, true)
  return projectId
}
