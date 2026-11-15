import type { command as runCommand } from "./process"
import { beforeEach, expect, test, vi } from "vitest"
import { cleanupProjectResources } from "./environment"
import { Evidence } from "./evidence"

const command = vi.fn<typeof runCommand>()

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(Evidence.prototype, "write").mockResolvedValue(undefined)
})

test.each([
  "No such container: removed-container",
  "can not get logs from container which is dead or marked for removal",
])("finishes scoped cleanup when a backend removes a listed container: %s", async message => {
  vi.mocked(command)
    .mockResolvedValue("")
    .mockResolvedValueOnce("removed-container")
    .mockResolvedValueOnce("")
    .mockResolvedValueOnce("")
    .mockRejectedValueOnce(new Error(message))

  const evidence = new Evidence("unused")
  await cleanupProjectResources("test-project", evidence, command)

  expect(command).toHaveBeenCalledWith(["docker", "logs", "removed-container"], {
    evidence,
    name: "container-removed-container.log",
  })

  expect(command).toHaveBeenCalledWith([
    "docker",
    "container",
    "ls",
    "-a",
    "-q",
    "--filter",
    "label=highstate.io/project=test-project",
  ])
})

test("does not hide unrelated Docker failures during evidence collection", async () => {
  const failure = new Error("Permission denied")

  vi.mocked(command)
    .mockResolvedValue("")
    .mockResolvedValueOnce("owned-container")
    .mockResolvedValueOnce("")
    .mockResolvedValueOnce("")
    .mockRejectedValueOnce(failure)

  await expect(
    cleanupProjectResources("test-project", new Evidence("unused"), command),
  ).rejects.toBe(failure)
})
