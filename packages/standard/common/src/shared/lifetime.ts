import { getOrCreate } from "@highstate/contract"
import { ResourceHook, setResourceHooks } from "@highstate/pulumi"

export type LifetimeScopeHooks = {
  beforeCreate: ResourceHook[]
  beforeUpdate: ResourceHook[]
  beforeDelete: ResourceHook[]
  afterCreate: ResourceHook[]
  afterUpdate: ResourceHook[]
  afterDelete: ResourceHook[]
}

export type LifetimeScopeRef = {
  /**
   * Disposes the reference by calling "unref" on the scope.
   * Can be safely called multiple times, but should be called at least once to ensure proper cleanup of the scope.
   */
  [Symbol.asyncDispose](): Promise<void>
}

export type LifetimeScope = {
  /**
   * The Pulumi hooks that should be executed to manage the lifetime of units within this scope.
   */
  hooks: LifetimeScopeHooks

  /**
   * Allows to manually increment the reference count for this scope and trigger the setup function if this is the first reference.
   *
   * Also returns a `LifetimeScopeRef` that should be disposed if "unref" is not called manually to ensure proper cleanup of the scope.
   */
  ref(): Promise<LifetimeScopeRef>

  /**
   * Allows to manually decrement the reference count for this scope and trigger the dispose function if this is the last reference.
   */
  unref(): Promise<void>
}

export const emptyLifetimeScope: LifetimeScope = {
  hooks: {
    beforeCreate: [],
    beforeUpdate: [],
    beforeDelete: [],
    afterCreate: [],
    afterUpdate: [],
    afterDelete: [],
  },
  ref: async () => ({
    [Symbol.asyncDispose]: async () => {},
  }),
  unref: async () => {},
}

const scopes = new Map<string, LifetimeScope>()
const UNREF_DELAY_MS = 5_000 // TODO: lower timeout

function createLifetimeScope(
  name: string,
  setup: () => Promise<void>,
  dispose: () => Promise<void>,
): LifetimeScope {
  let setupPromise: Promise<void> | undefined
  let disposePromise: Promise<void> | undefined
  let counter = 0
  let pendingUnrefs = 0
  let unrefTimer: ReturnType<typeof setTimeout> | undefined

  const schedulePendingUnrefs = () => {
    if (unrefTimer) {
      return
    }

    unrefTimer = setTimeout(() => {
      unrefTimer = undefined

      if (pendingUnrefs === 0) {
        return
      }

      counter = Math.max(0, counter - pendingUnrefs)
      pendingUnrefs = 0

      if (counter === 0) {
        disposePromise = setupPromise?.then(() => dispose())
      }
    }, UNREF_DELAY_MS)
  }

  const ref = async () => {
    if (pendingUnrefs > 0) {
      pendingUnrefs--

      if (pendingUnrefs === 0 && unrefTimer) {
        clearTimeout(unrefTimer)
        unrefTimer = undefined
      }

      return setupPromise
    }

    if (counter === 0) {
      setupPromise = setup()
    }

    counter++

    return setupPromise
  }

  const unref = async () => {
    if (counter - pendingUnrefs === 0) {
      return disposePromise
    }

    pendingUnrefs++
    schedulePendingUnrefs()

    return disposePromise
  }

  const before = new ResourceHook(`${name}-setup`, ref)
  const after = new ResourceHook(`${name}-dispose`, unref)

  setResourceHooks()

  return {
    hooks: {
      beforeCreate: [before],
      beforeUpdate: [before],
      beforeDelete: [before],
      afterCreate: [after],
      afterUpdate: [after],
      afterDelete: [after],
    },
    ref: async () => {
      await ref()

      let disposePromise: Promise<void> | undefined

      return {
        [Symbol.asyncDispose]: () => {
          if (!disposePromise) {
            disposePromise = unref()
          }

          return disposePromise
        },
      }
    },
    unref,
  }
}

export function getOrCreateLifetimeScope(
  name: string,
  setup: () => Promise<void>,
  dispose: () => Promise<void>,
): LifetimeScope {
  return getOrCreate(scopes, name, () => createLifetimeScope(name, setup, dispose))
}

export class LifetimeScopeContainer {
  constructor(protected readonly scope: LifetimeScope) {}

  get hooks() {
    return this.scope.hooks
  }
}

export function mergeResourceHooks(hooksArrays: LifetimeScopeHooks[]): LifetimeScopeHooks {
  const merged: LifetimeScopeHooks = {
    beforeCreate: [],
    beforeUpdate: [],
    beforeDelete: [],
    afterCreate: [],
    afterUpdate: [],
    afterDelete: [],
  }

  for (const hooks of hooksArrays) {
    merged.beforeCreate.push(...hooks.beforeCreate)
    merged.beforeUpdate.push(...hooks.beforeUpdate)
    merged.beforeDelete.push(...hooks.beforeDelete)
    merged.afterCreate.push(...hooks.afterCreate)
    merged.afterUpdate.push(...hooks.afterUpdate)
    merged.afterDelete.push(...hooks.afterDelete)
  }

  return merged
}
