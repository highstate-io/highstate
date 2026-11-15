import { describe, expect, it } from "vitest"
import { queryLibraryPackages } from "./packages"

const packages = [
  { packageName: "@example/zebra", version: "1.0.10" },
  { packageName: "@example/alpha", version: "1.0.2" },
  { packageName: "unscoped", version: "2.0.0" },
]

describe("library settings package table", () => {
  it("queries unresolved selections without needing a snapshot and keeps stable CUID identities", () => {
    const result = queryLibraryPackages(packages, " ALPHA ", [], 1, 20)
    expect(result).toMatchObject({ total: 1, hasNextPage: false })
    expect(result.items[0]).toMatchObject(packages[1])
    expect(result.items[0].id).toMatch(/^[a-z][a-z0-9]{23}$/)
    const updated = queryLibraryPackages([{ ...packages[1], version: "1.0.3" }], "", [], 1, 20)
    expect(updated.items[0].id).toBe(result.items[0].id)
  })

  it("sorts and pages without mutating the live selection", () => {
    const result = queryLibraryPackages(packages, "", [{ key: "version", order: "asc" }], 1, 2)
    expect(result.items.map(pkg => pkg.version)).toEqual(["1.0.2", "1.0.10"])
    expect(result.hasNextPage).toBe(true)
    expect(
      queryLibraryPackages(packages, "", [{ key: "meta.title", order: "asc" }], 2, 2).items[0]
        .packageName,
    ).toBe("unscoped")
    expect(packages[0].packageName).toBe("@example/zebra")
  })

  it("clears search and reports empty results correctly", () => {
    expect(queryLibraryPackages(packages, null, [], 1, 20).total).toBe(3)
    expect(queryLibraryPackages(packages, "missing", [], 1, 20)).toEqual({
      items: [],
      total: 0,
      hasNextPage: false,
    })
  })
})
