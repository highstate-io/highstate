import { expect, test } from "vitest"
import { Cleanup } from "./cleanup"

test("disposes in reverse order and continues after a failure", async () => {
  const cleanup = new Cleanup()
  const calls: string[] = []
  const failure = new Error("Disposal failed")

  cleanup.add(async () => {
    calls.push("first")
  })

  cleanup.add(async () => {
    calls.push("second")
    throw failure
  })

  cleanup.add(async () => {
    calls.push("third")
  })

  await expect(cleanup.run()).rejects.toMatchObject({ errors: [failure] })
  expect(calls).toEqual(["third", "second", "first"])
})
