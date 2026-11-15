import { EventEmitter } from "node:events"
import fs from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import Watcher from "watcher"

afterEach(() => vi.restoreAllMocks())

test("anonymous parent events stay scoped to the watched root without scanning siblings", async () => {
  const parent = await mkdtemp(join(tmpdir(), "highstate-watcher-"))
  const workspace = join(parent, "workspace")
  const sibling = join(parent, "unrelated")
  await mkdir(workspace)
  await mkdir(sibling)
  await writeFile(join(sibling, "private.ts"), "unrelated")
  const watches = new Map<string, EventEmitter>()
  const reads = vi.spyOn(fs, "readdir")

  vi.spyOn(fs, "watch").mockImplementation((path => {
    const emitter = Object.assign(new EventEmitter(), {
      close: vi.fn(),
      ref: vi.fn(),
      unref: vi.fn(),
    })

    watches.set(String(path), emitter)
    return emitter as fs.FSWatcher
  }) as typeof fs.watch)

  const watcher = new Watcher(workspace, { recursive: true, ignoreInitial: true, debounce: 5 })

  try {
    await new Promise<void>((resolve, reject) => {
      watcher.once("ready", resolve)
      watcher.once("error", reject)
    })

    const changed = new Promise<void>((resolve, reject) => {
      watcher.on("all", (_event, path) => {
        if (path === join(workspace, "inside.ts")) {
          resolve()
        }
      })

      watcher.once("error", reject)
    })

    // fs.watch permits a missing filename. Bun and some OS events deliver this in practice.
    watches.get(parent)?.emit("change", "rename", null)
    await writeFile(join(workspace, "inside.ts"), "inside")
    watches.get(workspace)?.emit("change", "rename", "inside.ts")
    await changed
    expect([...watches.keys()].sort()).toEqual([parent, workspace].sort())
    expect(reads.mock.calls.map(([path]) => String(path))).not.toContain(parent)
    expect(reads.mock.calls.map(([path]) => String(path))).not.toContain(sibling)
  } finally {
    watcher.close()
    await rm(parent, { recursive: true, force: true })
  }
}, 10_000)
