import type { Logger } from "pino"
import { getActivePinia, type StoreDefinition } from "pinia"

export type CreateParams<TStoreId extends unknown[]> = {
  storeId: string
  id: TStoreId
  onDeactivated: (callback: () => void) => void
  logger: Logger
}

export type MultiStoreOptions<TStoreId extends unknown[], TStoreDef extends StoreDefinition> = {
  /**
   * The unique name of the store shared across all instances.
   * Used to identify the store in parent scope.
   */
  name: string

  /**
   * Creates the store id string from the given id.
   *
   * @param id The store id.
   * @returns The full store id.
   */
  getStoreId: (...id: TStoreId) => string

  /**
   * Creates a new store instance definition for the given id.
   *
   * @param params The store creation parameters.
   * @returns The store definition for particular id.
   */
  create: (params: CreateParams<TStoreId>) => TStoreDef
}

export type StoreAccessor<TStoreId extends unknown[], TStoreDef extends StoreDefinition> = {
  /**
   * Gets the store instance from the parent scope.
   * If no store injected in the parent scope, throws an error.
   */
  (): ReturnType<TStoreDef>

  /**
   * Gets the store instance for the given id.
   * If not store with the given id exists, throws an error.
   *
   * Does not register the current component as store root and do not affect on the store lifecycle.
   */
  (...id: TStoreId): ReturnType<TStoreDef>

  /**
   * Gets the store instance for the given id.
   * Waits for the store to be created if it doesn't exist.
   *
   * Does not register the current component as store root and do not affect on the store lifecycle.
   */
  async(...id: TStoreId): Promise<ReturnType<TStoreDef>>

  /**
   * Ensures that the store instance for the given id is created.
   * Registers the current component as store root and affects on the store lifecycle.
   *
   * Must be called inside a setup function.
   */
  ensureCreated(...id: TStoreId): ReturnType<TStoreDef>
}

export function defineMultiStore<TStoreId extends unknown[], TStoreDef extends StoreDefinition>({
  name,
  getStoreId,
  create,
}: MultiStoreOptions<TStoreId, TStoreDef>): StoreAccessor<TStoreId, TStoreDef> {
  type StoreInstance = {
    storeDef: TStoreDef
    refCount: number
    triggerDeactivated: () => void
  }

  const stores = reactive(new Map<string, StoreInstance>()) as Map<string, StoreInstance>

  const getFromContext = (): ReturnType<TStoreDef> => {
    if (!getCurrentInstance()) {
      throw new Error(
        `Cannot access store "${name}": either provided ID or call inside a setup function.`,
      )
    }

    const store = injectLocal<StoreInstance>(`store:${name}`)

    if (!store) {
      throw new Error(
        `No store named "${name}" available in the parent scope: provide an ID explicitly.`,
      )
    }

    return store.storeDef() as ReturnType<TStoreDef>
  }

  const accessor = (...id: TStoreId): ReturnType<TStoreDef> => {
    if (!id.length) {
      // if no id is provided, return the store from the parent scope
      return getFromContext()
    }

    const storeId = getStoreId(...id)

    const store = stores.get(storeId)
    if (store) {
      return store.storeDef() as ReturnType<TStoreDef>
    }

    throw new Error(
      `No store with ID "${storeId}" found: ensure that the store is created via "ensureCreated".`,
    )
  }

  accessor.ensureCreated = (...id: TStoreId): ReturnType<TStoreDef> => {
    if (!getCurrentInstance()) {
      throw new Error(
        `Cannot create store "${name}": call "ensureCreated" inside a setup function.`,
      )
    }

    const storeId = getStoreId(...id)

    let store = stores.get(storeId)
    if (!store) {
      const { on: onDeactivated, trigger: triggerDeactivated } = createEventHook()

      store = {
        storeDef: create({
          storeId,
          id: id,
          onDeactivated,
          logger: globalLogger.child({ storeId, storeName: name }),
        }),
        refCount: 0,
        triggerDeactivated,
      }
      stores.set(storeId, store)

      globalLogger.debug({ storeId, storeName: name }, "created new store instance")
    }

    store.refCount++

    globalLogger.debug(
      { storeId, storeName: name, refCount: store.refCount, instance: getCurrentInstance()?.type },
      "store instance reference count increased",
    )

    onScopeDispose(() => {
      store.refCount--

      globalLogger.debug(
        {
          storeId,
          storeName: name,
          refCount: store.refCount,
          instance: getCurrentInstance()?.type,
        },
        "store instance reference count decreased",
      )

      if (store.refCount > 0) {
        return
      }

      stores.delete(storeId)

      // Trigger the store disposal event
      store.triggerDeactivated()

      // Unregister the store from the Pinia store registry
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const storeInstance = store.storeDef as any
      storeInstance().$dispose()

      // Delete the store state
      const pinia = getActivePinia()

      delete pinia!.state.value[storeId]

      globalLogger.info({ storeId, storeName: name }, "store instance disposed")
    })

    provideLocal(`store:${name}`, store)

    return store.storeDef() as ReturnType<TStoreDef>
  }

  accessor.async = async (...id: TStoreId) => {
    const storeId = getStoreId(...id)

    globalLogger.debug({ storeId, storeName: name }, "async: waiting for store instance")
    const store = await until(() => stores.get(storeId)).toBeTruthy()

    globalLogger.debug({ storeId, storeName: name }, "async: store instance found")

    return store.storeDef() as ReturnType<TStoreDef>
  }

  return accessor
}
