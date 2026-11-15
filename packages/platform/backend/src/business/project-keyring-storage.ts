import type { KeyringRequest } from "./project-keyring-helper"
import { fileURLToPath } from "node:url"
import { execa } from "execa"
import { resolve } from "import-meta-resolve"

/**
 * Isolates native keyring calls from Bun's HTTP request and reload contexts.
 */
export class ProjectKeyringStorage {
  constructor(private readonly execute = execa) {}

  async read(): Promise<{ account: string; password: string }[]> {
    return (await this.run({ operation: "read" })) as { account: string; password: string }[]
  }

  async write(account: string, value: string): Promise<void> {
    await this.run({ operation: "write", account, value })
  }

  async probe(): Promise<void> {
    await this.run({ operation: "probe" })
  }

  private async run(request: KeyringRequest): Promise<unknown> {
    const helper = fileURLToPath(
      resolve("@highstate/backend/project-keyring-helper", import.meta.url),
    )

    // secrets travel only through private pipes, never command arguments or temporary files
    const result = await this.execute(process.execPath, [helper], {
      input: JSON.stringify(request),
      reject: false,
      timeout: 30_000,
    })

    if (result.failed) {
      throw new Error(`System keyring ${request.operation} failed`, {
        cause: new Error(result.stderr || "Keyring helper exited without a result"),
      })
    }

    return JSON.parse(result.stdout)
  }
}
