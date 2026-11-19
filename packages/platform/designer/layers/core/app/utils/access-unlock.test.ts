import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { computed, effectScope, nextTick, onScopeDispose, ref, shallowRef, watch } from "vue"
import { useProjectUnlockState } from "./use-project-unlock-state"

const unsubscribe = vi.fn()
const subscribe = vi.fn().mockReturnValue({ unsubscribe })
const mutate = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("shallowRef", shallowRef)
  vi.stubGlobal("computed", computed)
  vi.stubGlobal("onScopeDispose", onScopeDispose)
  vi.stubGlobal("watch", watch)
  vi.stubGlobal("useAccess", () => ({ status: () => ({ allowed: true, reason: "" }) }))

  vi.stubGlobal("useNuxtApp", () => ({
    $client: {
      state: {
        watchUnlockState: { subscribe },
        unlockProject: { mutate },
      },
    },
  }))
})

afterEach(() => vi.unstubAllGlobals())

test("clears denied project state and reconnects automatically when access returns", async () => {
  const status = ref({ allowed: true, reason: "" })
  vi.stubGlobal("useAccess", () => ({ status: () => status.value }))
  const scope = effectScope()
  const state = scope.run(() => useProjectUnlockState("project"))!
  subscribe.mock.calls[0]![1].onData({ type: "unlocked" })
  status.value = { allowed: false, reason: "Missing project access" }
  await nextTick()
  expect(state.unlockState.value).toBeUndefined()
  expect(state.failure.value).toMatchObject({ statusCode: 403 })
  expect(unsubscribe).toHaveBeenCalledOnce()
  status.value = { allowed: true, reason: "" }
  await nextTick()
  expect(subscribe).toHaveBeenCalledTimes(2)
  expect(state.failure.value).toBeUndefined()
  scope.stop()
})

test("preserves unlocked content when permission polls return unchanged access", async () => {
  const status = ref({ allowed: true, reason: "" })
  vi.stubGlobal("useAccess", () => ({ status: () => status.value }))
  const scope = effectScope()
  const state = scope.run(() => useProjectUnlockState("project"))!
  subscribe.mock.calls[0]![1].onData({ type: "unlocked" })
  status.value = { allowed: true, reason: "" }
  await nextTick()
  expect(subscribe).toHaveBeenCalledOnce()
  expect(unsubscribe).not.toHaveBeenCalled()
  expect(state.unlockState.value).toEqual({ type: "unlocked" })
  scope.stop()
})

test("reads unlock state without initializing protected model or worker stores", () => {
  const scope = effectScope()
  const state = scope.run(() => useProjectUnlockState("project"))!
  expect(subscribe).toHaveBeenCalledWith({ projectId: "project" }, expect.any(Object))
  subscribe.mock.calls[0]![1].onData({ type: "unlocked" })
  expect(state.unlockState.value).toEqual({ type: "unlocked" })
  scope.stop()
  expect(unsubscribe).toHaveBeenCalledOnce()
})

test("reports subscription rejection instead of waiting indefinitely for unlock state", () => {
  const scope = effectScope()
  const state = scope.run(() => useProjectUnlockState("project"))!
  const error = new Error("Permission denied")
  subscribe.mock.calls[0]![1].onError(error)
  expect(state.failure.value).toBe(error)
  scope.stop()
})

test("keeps keyring-only project unlock methods available", () => {
  const scope = effectScope()
  const state = scope.run(() => useProjectUnlockState("project"))!

  subscribe.mock.calls[0]![1].onData({
    type: "locked",
    unlockSuite: {
      encryptedIdentities: [],
      hasPasskey: false,
      keyrings: [
        { recipient: "test-recipient", encryptedIdentity: "test-identity", autoUnlock: false },
      ],
      passkeys: [],
    },
  })

  expect(state.isUnlockImpossible.value).toBe(false)
  scope.stop()
})

test("detects unavailable unlock methods and submits identities only through the authorized endpoint", async () => {
  const scope = effectScope()
  const state = scope.run(() => useProjectUnlockState("project"))!
  subscribe.mock.calls[0]![1].onData({ type: "locked" })
  expect(state.isUnlockImpossible.value).toBe(true)
  await state.unlockWithIdentity("test-identity")
  expect(mutate).toHaveBeenCalledWith({ projectId: "project", decryptedIdentity: "test-identity" })
  scope.stop()
})
