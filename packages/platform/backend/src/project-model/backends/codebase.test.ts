import type { ProjectOutput } from "../../shared"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import pino from "pino"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { CodebaseProjectModelBackend } from "./codebase"

const project = { id: "project", name: "project" } as ProjectOutput
const spec = { type: "codebase" } as const

describe("CodebaseProjectModelBackend.patchInstanceArguments", () => {
  let projectsDir: string
  let backend: CodebaseProjectModelBackend

  beforeEach(async () => {
    projectsDir = await mkdtemp(resolve(tmpdir(), "highstate-project-model-"))
    backend = new CodebaseProjectModelBackend(projectsDir, pino({ level: "silent" }))
    await backend.createProjectModel(project, spec)
    await backend.createNodes(
      project,
      spec,
      [
        {
          id: "example.component.v1:main",
          kind: "unit",
          type: "example.component.v1",
          name: "main",
          args: { count: 1 },
        },
      ],
      [],
    )
  })

  afterEach(async () => {
    await rm(projectsDir, { recursive: true, force: true })
  })

  test("persists a validated patch atomically", async () => {
    const instance = await backend.patchInstanceArguments(
      project,
      spec,
      "example.component.v1:main",
      [{ operation: "replace", path: "/count", value: 2 }],
      () => undefined,
      false,
    )

    expect(instance.args).toEqual({ count: 2 })
    await expect(currentArgs()).resolves.toEqual({ count: 2 })
  })

  test("does not persist a dry run", async () => {
    const instance = await backend.patchInstanceArguments(
      project,
      spec,
      "example.component.v1:main",
      [{ operation: "replace", path: "/count", value: 2 }],
      () => undefined,
      true,
    )

    expect(instance.args).toEqual({ count: 2 })
    await expect(currentArgs()).resolves.toEqual({ count: 1 })
  })

  test("does not persist when validation fails", async () => {
    await expect(
      backend.patchInstanceArguments(
        project,
        spec,
        "example.component.v1:main",
        [{ operation: "replace", path: "/count", value: 2 }],
        () => {
          throw new Error("Invalid arguments")
        },
        false,
      ),
    ).rejects.toThrow("Failed to patch instance arguments")
    await expect(currentArgs()).resolves.toEqual({ count: 1 })
  })

  async function currentArgs(): Promise<Record<string, unknown> | undefined> {
    const model = await backend.getProjectModel(project, spec)
    return model.instances[0]?.args
  }
})
