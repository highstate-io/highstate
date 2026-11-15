import { randomUUID } from "node:crypto"
import { AsyncEntry, findCredentialsAsync } from "@napi-rs/keyring"

export type KeyringRequest =
  | { operation: "read" }
  | { operation: "write"; account: string; value: string }
  | { operation: "probe" }

const service = "io.highstate.project"

async function run(request: KeyringRequest) {
  if (request.operation === "read") {
    return await findCredentialsAsync(service)
  }

  const probe = request.operation === "probe"
  const entry = new AsyncEntry(service, probe ? `probe:${randomUUID()}` : request.account)
  const value = probe ? randomUUID() : request.value
  let created = false

  try {
    await entry.setPassword(value)
    created = true

    if ((await entry.getPassword()) !== value) {
      throw new Error("System keyring read-back failed")
    }
  } finally {
    if (probe && created) {
      await entry.deleteCredential()
    }
  }

  return null
}

try {
  let input = ""

  for await (const chunk of process.stdin) {
    input += chunk
  }

  const request: KeyringRequest = JSON.parse(input)
  process.stdout.write(JSON.stringify(await run(request)))
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : "System keyring operation failed")
  process.exitCode = 1
}
