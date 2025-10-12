import type { BetterLock as BetterLockType } from "better-lock/dist/better_lock"
import type { LockBackend } from "./abstractions"
import { BetterLock } from "better-lock"

export class MemoryLockBackend implements LockBackend {
  private readonly lock: BetterLockType

  private constructor() {
    this.lock = new BetterLock()
  }

  async acquire<T>(keys: string[], fn: () => Promise<T> | T): Promise<T> {
    return this.lock.acquire(keys, fn)
  }

  static create(): LockBackend {
    return new MemoryLockBackend()
  }
}
