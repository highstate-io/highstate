import type { RunnerBackend, UnitOptions } from "./abstractions"
import { expect, test, vi } from "vitest"
import { LazyRunnerBackend } from "./lazy"

test("initializes legacy tooling only on demand and shares initialization across callers", async () => {
  const refresh = vi.fn(async () => {})
  const finish = vi.fn(async () => {})
  const dispose = vi.fn(async () => {})

  const create = vi.fn(
    async () =>
      ({
        refresh,
        finishOperation: finish,
        [Symbol.asyncDispose]: dispose,
      }) as unknown as RunnerBackend,
  )

  const lazy = new LazyRunnerBackend(create)
  await lazy.finishOperation("project", "operation")
  expect(create).not.toHaveBeenCalled()
  const options = {} as UnitOptions
  await Promise.all([lazy.refresh(options), lazy.refresh(options)])
  expect(create).toHaveBeenCalledOnce()
  expect(refresh).toHaveBeenCalledTimes(2)
  await lazy.finishOperation("project", "operation")
  expect(finish).toHaveBeenCalledWith("project", "operation")
  await lazy[Symbol.asyncDispose]()
  expect(dispose).toHaveBeenCalledOnce()
})
