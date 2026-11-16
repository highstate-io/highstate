import { cuidv2d } from "@highstate/contract"
import { describe, expect, it } from "vitest"
import { queryRuntimeSettings } from "./runtime-settings-table"

const [backupId, localId, remoteId] = ["backup", "local", "remote"]
  .map(name => cuidv2d("runtime-table-test", name))
  .sort()

const timestamps = { createdAt: new Date(), updatedAt: new Date(), systemName: null }

const items = [
  {
    id: remoteId,
    ...timestamps,
    revision: cuidv2d("runtime-table-revision", "remote"),
    meta: { title: "Remote", description: "Production cluster" },
    spec: { url: "s3://production", credentialsConfigured: false },
  },
  {
    id: localId,
    ...timestamps,
    revision: cuidv2d("runtime-table-revision", "local"),
    meta: { title: "Local", description: "Development storage" },
    spec: { url: "file:///state", credentialsConfigured: false },
  },
  {
    id: backupId,
    ...timestamps,
    revision: cuidv2d("runtime-table-revision", "backup"),
    meta: { title: "Backup" },
    spec: { url: "s3://backup", credentialsConfigured: false },
  },
]

describe("runtime settings table", () => {
  it("restores the unfiltered collection when the clearable search is reset", () => {
    expect(queryRuntimeSettings(items, null, [], 1, 20).items).toEqual(items)
  })

  it("searches identifiers, titles, and descriptions without case or surrounding whitespace", () => {
    for (const search of [remoteId, " REMOTE ", "production", "cluster"]) {
      expect(queryRuntimeSettings(items, search, [], 1, 20).items.map(item => item.id)).toEqual([
        remoteId,
      ])
    }

    expect(queryRuntimeSettings(items, "missing", [], 1, 20)).toMatchObject({
      items: [],
      total: 0,
      hasNextPage: false,
    })
  })

  it("sorts names before paging and retains the source collection order", () => {
    const result = queryRuntimeSettings(items, "", [{ key: "meta.title", order: "desc" }], 1, 2)
    expect(result.items.map(item => item.id)).toEqual([remoteId, localId])
    expect(result).toMatchObject({ total: 3, hasNextPage: true })
    const last = queryRuntimeSettings(items, "", [{ key: "meta.title", order: "desc" }], 2, 2)
    expect(last.items.map(item => item.id)).toEqual([backupId])
    expect(last.hasNextPage).toBe(false)
    expect(items.map(item => item.id)).toEqual([remoteId, localId, backupId])
  })

  it("never sorts by opaque concurrency tokens", () => {
    expect(
      queryRuntimeSettings(items, "", [{ key: "revision", order: "desc" }], 1, 20).items,
    ).toEqual(items)
  })

  it("sorts names and identifiers in the requested direction", () => {
    expect(
      queryRuntimeSettings(items, "", [{ key: "meta.title", order: "asc" }], 1, 20).items.map(
        item => item.id,
      ),
    ).toEqual([backupId, localId, remoteId])

    expect(
      queryRuntimeSettings(items, "", [{ key: "id", order: "desc" }], 1, 20).items.map(
        item => item.id,
      ),
    ).toEqual([remoteId, localId, backupId])
  })
})
