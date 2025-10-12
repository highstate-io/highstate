export interface LockBackend {
  /**
   * Acquires locks for the given keys and executes the function.
   */
  acquire<T>(keys: string[], fn: () => Promise<T> | T): Promise<T>
}
