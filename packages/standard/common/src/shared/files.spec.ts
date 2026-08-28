import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { common } from "@highstate/library"
import { makeEntity } from "@highstate/pulumi"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MaterializedFolder } from "./files"

let unitTempPath: string

beforeEach(async () => {
  unitTempPath = await mkdtemp(join(tmpdir(), "highstate-materialized-folder-"))
})

afterEach(async () => {
  await rm(unitTempPath, { recursive: true, force: true })
})

describe("MaterializedFolder", () => {
  it("materializes files in an embedded folder", async () => {
    const file = makeEntity({
      entity: common.fileEntity,
      identity: "embedded-file",
      value: {
        meta: {
          name: "index.html",
        },
        content: {
          type: "embedded",
          value: "fallback",
        },
      },
    })
    const folder = makeEntity({
      entity: common.folderEntity,
      identity: "embedded-folder",
      value: {
        meta: {
          name: "site",
        },
        content: {
          type: "embedded",
        },
        files: [file],
        folders: [],
      },
    })

    const parent = { path: unitTempPath } as MaterializedFolder
    const materializedFolder = await MaterializedFolder.open(folder, parent)

    await expect(readFile(join(materializedFolder.path, "index.html"), "utf8")).resolves.toBe(
      "fallback",
    )
  })
})
