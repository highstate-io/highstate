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

  sanitize(value: string): string {
    for (const secret of this.secrets) {
      value = value.replaceAll(secret, "[redacted]")
    }

    return value
      .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]")
      .replace(
        /^([\t ]*(?:-[\t ]*)?(?:cookie|set-cookie|authorization)[\t ]*:)[^\r\n]*/gim,
        "$1 [redacted]",
      )
  }

  async write(name: string, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true })

    const text =
      typeof value === "string"
        ? this.sanitize(value)
        : JSON.stringify(
            value,
            (key, value: unknown) => {
              if (/^(cookie|set-cookie|authorization)$/i.test(key)) {
                return "[redacted]"
              }

              if (typeof value === "bigint") {
                return value.toString()
              }

              return typeof value === "string" ? this.sanitize(value) : value
            },
            2,
          )

    await writeFile(join(this.directory, name), text)
  }
}
