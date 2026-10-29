import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * Stores publishable evidence separately from private keys, tokens, and databases.
 */
export class Evidence {
  private readonly secrets = new Set<string>()

  constructor(readonly directory: string) {}

  redact(value: string): void {
    this.secrets.add(value)
  }

  async write(name: string, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true })

    let text =
      typeof value === "string"
        ? value
        : JSON.stringify(
            value,
            (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
            2,
          )

    for (const secret of this.secrets) {
      text = text.replaceAll(secret, "[redacted]")
    }

    text = text.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    await writeFile(join(this.directory, name), text)
  }
}
