import { EventEmitter } from "node:events"
import fs from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import Watcher from "watcher"

afterEach(() => vi.restoreAllMocks())

test("root monitoring never opens ancestors or scans unrelated siblings", async () => {
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

    await writeFile(join(workspace, "inside.ts"), "inside")
    watches.get(workspace)?.emit("change", "rename", "inside.ts")
    await changed
    expect([...watches.keys()]).toEqual([workspace])
    expect(reads.mock.calls.map(([path]) => String(path))).not.toContain(parent)
    expect(reads.mock.calls.map(([path]) => String(path))).not.toContain(sibling)
  } finally {
    watcher.close()
    await rm(parent, { recursive: true, force: true })
  }
}, 10_000)

test("root replacement reattaches file watchers and forwards updates", async () => {
  const parent = await mkdtemp(join(tmpdir(), "highstate-watcher-replace-"))
  const workspace = join(parent, "workspace")
  await mkdir(workspace)
  const watches: EventEmitter[] = []

  vi.spyOn(fs, "watch").mockImplementation((() => {
    const emitter = Object.assign(new EventEmitter(), {
      close: vi.fn(),
      ref: vi.fn(),
      unref: vi.fn(),
    })

    watches.push(emitter)
    return emitter as fs.FSWatcher
  }) as typeof fs.watch)

  const watcher = new Watcher(workspace, {
    recursive: true,
    ignoreInitial: true,
    debounce: 5,
    pollingInterval: 10,
  })

  const next = (event: string, target: string) =>
    new Promise<void>((resolve, reject) => {
      watcher.on(event, path => {
        if (path === target) {
          resolve()
        }
      })

      watcher.once("error", reject)
    })

  try {
    await new Promise<void>((resolve, reject) => {
      watcher.once("ready", resolve)
      watcher.once("error", reject)
    })

    const removed = next("unlinkDir", workspace)
    await rm(workspace, { recursive: true })
    await removed
    const restored = next("addDir", workspace)
    await mkdir(workspace)
    await restored
    const file = join(workspace, "restored.ts")
    expect(watches).toHaveLength(2)
    expect(watches[0]).not.toBe(watches[1])
    const added = next("add", file)
    await writeFile(file, "restored")
    watches[1]!.emit("change", "rename", "restored.ts")
    await added
  } finally {
    watcher.close()
    await rm(parent, { recursive: true, force: true })
  }
}, 15_000)
