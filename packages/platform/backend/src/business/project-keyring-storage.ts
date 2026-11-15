import { execa } from "execa"
import { resolve } from "import-meta-resolve"

type KeyringRequest =
  | { operation: "read" }
  | { operation: "write"; account: string; value: string }
  | { operation: "probe" }

const serviceName = "io.highstate.project-unlock"

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
    // secrets travel only through private pipes, never command arguments or temporary files
    const script = `
      import { AsyncEntry, findCredentialsAsync } from ${JSON.stringify(resolve("@napi-rs/keyring", import.meta.url))};
      import { randomUUID } from "node:crypto";
      let input = "";
      for await (const chunk of process.stdin) input += chunk;
      const request = JSON.parse(input);
      const service = ${JSON.stringify(serviceName)};
      try {
        let result = null;
        if (request.operation === "read") {
          result = await findCredentialsAsync(service);
        } else {
          const probe = request.operation === "probe";
          const entry = new AsyncEntry(service, probe ? "probe:" + randomUUID() : request.account);
          const value = probe ? randomUUID() : request.value;
          let created = false;
          try {
            await entry.setPassword(value);
            created = true;
            if (await entry.getPassword() !== value) throw new Error("System keyring read-back failed");
          } finally {
            if (probe && created) await entry.deleteCredential();
          }
        }
        process.stdout.write(JSON.stringify(result));
      } catch (error) {
        process.stderr.write(error instanceof Error ? error.message : "System keyring operation failed");
        process.exitCode = 1;
      }
    `

    const result = await this.execute(process.execPath, ["--input-type=module", "-e", script], {
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
