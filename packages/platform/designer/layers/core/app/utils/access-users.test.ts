import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { effectScope, nextTick, ref, toValue, watch } from "vue"
import { useUsersRevision } from "./use-users-revision"

const stopBackend = vi.fn()
const stopProject = vi.fn()
const backend = vi.fn().mockReturnValue({ unsubscribe: stopBackend })
const project = vi.fn().mockReturnValue({ unsubscribe: stopProject })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("watch", watch)
  vi.stubGlobal("toValue", toValue)

  vi.stubGlobal("useNuxtApp", () => ({
    $client: {
      backendUserSettings: { watch: { subscribe: backend } },
      projectUserSettings: { watch: { subscribe: project } },
    },
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test("subscribes to exactly one realm and reloads only on server updates", () => {
  const changed = vi.fn()
  const scope = effectScope()
  scope.run(() => useUsersRevision("project", "user", true, changed, true))

  expect(project).toHaveBeenCalledWith(
    { projectId: "project", userId: "user", bindings: true },
    expect.any(Object),
  )

  expect(backend).not.toHaveBeenCalled()
  expect(changed).not.toHaveBeenCalled()
  project.mock.calls[0]![1].onData("revision")
  expect(changed).toHaveBeenCalledOnce()
  scope.stop()
  expect(stopProject).toHaveBeenCalledOnce()
})

test("stops live reads on access loss and reconnects when permission returns", async () => {
  const allowed = ref(true)
  const scope = effectScope()
  scope.run(() => useUsersRevision(undefined, undefined, allowed, vi.fn()))
  allowed.value = false
  await nextTick()
  expect(stopBackend).toHaveBeenCalledOnce()
  allowed.value = true
  await nextTick()
  expect(backend).toHaveBeenCalledTimes(2)
  scope.stop()
})

test("retries disconnected streams but never reloads after unmount", async () => {
  vi.useFakeTimers()
  const changed = vi.fn()
  const scope = effectScope()
  scope.run(() => useUsersRevision(undefined, undefined, true, changed))
  const observer = backend.mock.calls[0]![1]
  observer.onError(new Error("Disconnected"))
  expect(changed).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1000)
  expect(backend).toHaveBeenCalledTimes(2)
  scope.stop()
  observer.onData("late")
  observer.onError(new Error("Late"))
  expect(changed).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1000)
  expect(backend).toHaveBeenCalledTimes(2)
})
