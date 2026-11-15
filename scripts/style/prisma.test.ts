import { describe, expect, it } from "vitest"
import { checkPrismaSource } from "./prisma"

describe("Prisma field documentation and spacing", () => {
  it("accepts documented, separated model fields and enum values", () => {
    const source = `model Item {
  /// The item's identity.
  id String @id

  /// Display metadata.
  ///
  /// [CommonObjectMeta]
  meta Json

  @@index([id])
}

enum State {
  /// Waiting to start.
  pending

  /// Finished successfully.
  ready
}
`

    expect(checkPrismaSource(source)).toEqual({ issues: [], source })
  })

  it.each(["model", "type", "view", "enum"])("requires docs on every %s entry", kind => {
    const source = `${kind} Item {\n  // Not a documentation comment.\n  value${kind === "enum" ? "" : " String"}\n}\n`

    expect(checkPrismaSource(source).issues).toEqual([
      { line: 3, message: "Document Item.value with ///" },
    ])

    expect(checkPrismaSource(source, true).source).not.toContain("///")
  })

  it.each(["///", "/// [SomeType]", "/// ![unknown]"])("rejects empty descriptions: %s", doc => {
    expect(checkPrismaSource(`model Item {\n  ${doc}\n  value String\n}\n`).issues).toEqual([
      { line: 3, message: "Document Item.value with ///" },
    ])
  })

  it("fixes missing spacing before the complete documentation block and is idempotent", () => {
    const source = `enum State {
  /// Waiting to start.
  pending
  /// Finished successfully.
  /// More details.
  ready
}
`

    expect(checkPrismaSource(source).issues).toEqual([
      { line: 4, message: "Separate Prisma fields with a blank line" },
    ])

    const fixed = checkPrismaSource(source, true)
    expect(fixed.issues).toEqual([])
    expect(fixed.source).toContain("  pending\n\n  /// Finished successfully.")
    expect(checkPrismaSource(fixed.source)).toEqual(fixed)
  })

  it("ignores datasource/generator options and fields inside block comments", () => {
    const source = `datasource db {
  provider = "sqlite"
}
generator client {
  provider = "prisma-client"
}
model Item {
  /*
  fake String
  */

  /// The item's identity.
  id String @id
}
`

    expect(checkPrismaSource(source).issues).toEqual([])
  })
})
