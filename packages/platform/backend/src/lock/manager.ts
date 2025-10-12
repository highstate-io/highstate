import type { LockBackend } from "./abstractions"
import { join } from "remeda"

export type LockKeyMap = {
  /**
   * Lock for instances and hubs of the project.
   */
  "project-nodes": [projectId: string]

  /**
   * Locks for the evaluation of the project.
   */
  "project-evaluation": [projectId: string]

  /**
   * Lock for all instance states of the project.
   */
  "project-instance-states": [projectId: string]

  /**
   * Lock for a specific instance within a project.
   */
  instance: [projectId: string, instanceId: string]

  /**
   * Lock for a specific instance lock within a project.
   */
  "instance-lock": [projectId: string, instanceId: string]

  /**
   * Lock for a specific artifact within a project.
   */
  artifact: [projectId: string, artifactId: string]

  /**
   * Lock for a specific artifact hash within a project.
   */
  "artifact-hash": [projectId: string, hash: string]

  /**
   * Lock for a specific operation within a project.
   */
  operation: [projectId: string, operationId: string]

  /**
   * Lock for a specific api key within a project.
   */
  "api-key": [projectId: string, key: string]

  /**
   * Lock for a specific worker within a project.
   */
  worker: [workerId: string]

  /**
   * Lock for a specific worker image within a project.
   */
  "worker-image": [projectId: string, image: string]
}

export type LockKey = Readonly<
  {
    [K in keyof LockKeyMap]: [type: K, ...LockKeyMap[K]]
  }[keyof LockKeyMap]
>

export class LockManager {
  constructor(private readonly lockBackend: LockBackend) {}

  /**
   * Acquires locks for the given keys and executes the function.
   *
   * This method provides a clean interface for acquiring distributed locks across
   * multiple keys and ensures they are properly released after execution.
   *
   * @param keys The keys to acquire locks for.
   * @param fn The function to execute while holding the locks.
   * @returns The result of the executed function.
   */
  public async acquire<T>(keys: LockKey | LockKey[], fn: () => Promise<T> | T): Promise<T> {
    if (typeof keys[0] === "string") {
      return this.lockBackend.acquire([keys.join(":")], fn)
    }

    return this.lockBackend.acquire(keys.map(join(":")), fn)
  }
}
