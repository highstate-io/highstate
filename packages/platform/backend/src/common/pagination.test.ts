import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { InvalidPageSizeError, InvalidPageTokenError } from "../shared/models/errors"
import { encodePageToken, queryDatabasePage, resolvePageRequest, toPageResult } from "./pagination"

describe("cursor pagination", () => {
  const cursorSchema = z.object({ id: z.string().min(1) })

  it("applies page size defaults and bounds", () => {
    expect(resolvePageRequest("items", {}, {}, cursorSchema).pageSize).toBe(20)
    expect(resolvePageRequest("items", { pageSize: 0 }, {}, cursorSchema).pageSize).toBe(0)
    expect(resolvePageRequest("items", { pageSize: 101 }, {}, cursorSchema).pageSize).toBe(100)
    expect(() => resolvePageRequest("items", { pageSize: -1 }, {}, cursorSchema)).toThrow(
      InvalidPageSizeError,
    )
  })

  it("round trips a query-bound cursor", () => {
    const token = encodePageToken("items", { parentId: "parent", filter: "one" }, { id: "item" })
    expect(
      resolvePageRequest(
        "items",
        { pageToken: token },
        { filter: "one", parentId: "parent" },
        cursorSchema,
      ).cursor,
    ).toEqual({ id: "item" })
  })

  it("rejects malformed and mismatched tokens", () => {
    const token = encodePageToken("items", { parentId: "parent" }, { id: "item" })

    expect(() => resolvePageRequest("other", { pageToken: token }, {}, cursorSchema)).toThrow(
      InvalidPageTokenError,
    )
    expect(() =>
      resolvePageRequest("items", { pageToken: token }, { parentId: "other" }, cursorSchema),
    ).toThrow(InvalidPageTokenError)
    expect(() => resolvePageRequest("items", { pageToken: "invalid" }, {}, cursorSchema)).toThrow(
      InvalidPageTokenError,
    )
  })

  it("returns a token only when an extra item exists", () => {
    expect(toPageResult([{ id: "one" }], 1, item => item.id)).toEqual({
      items: [{ id: "one" }],
      nextPageToken: undefined,
    })
    expect(toPageResult([{ id: "one" }, { id: "two" }], 1, item => item.id)).toEqual({
      items: [{ id: "one" }],
      nextPageToken: "one",
    })
  })

  it("executes bounded database queries with decoded cursors", async () => {
    const token = encodePageToken("items", { filter: "one" }, { id: "previous" })
    const fetch = vi.fn().mockResolvedValue([{ id: "one" }, { id: "two" }])

    const result = await queryDatabasePage<{ id: string }, string, { id: string }>({
      collection: "items",
      request: { pageSize: 1, pageToken: token },
      query: { filter: "one" },
      cursorSchema,
      fetch,
      cursor: item => ({ id: item.id }),
      map: item => item.id,
    })

    expect(fetch).toHaveBeenCalledWith({ cursor: { id: "previous" }, take: 2 })
    expect(result.items).toEqual(["one"])
    expect(result.nextPageToken).toBeTruthy()
  })
})
