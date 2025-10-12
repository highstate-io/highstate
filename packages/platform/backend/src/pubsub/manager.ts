import type { Logger } from "pino"
import type { WorkerVersionLog } from "../database"
import type { PubSubBackend } from "./abstractions"
import { z } from "zod"
import {
  instanceLockEventSchema,
  instanceStateEventSchema,
  type OperationLog,
  operationEventSchema,
  projectModelEventSchema,
  projectUnlockStateSchema,
  terminalSessionOutputSchema,
  workerUnitRegistrationEventSchema,
} from "../shared"

export type PubSubEventMap = {
  "project-unlock-state": [projectId: string]
  "instance-state": [projectId: string]
  "instance-lock": [projectId: string]
  "project-model": [projectId: string]
  operation: [projectId: string]
  "active-terminal-session": [projectId: string, sessionId: string]
  "operation-instance-log": [operationId: string, instanceId: string]
  "worker-unit-registration": [projectId: string, workerVersionId: string]
  "worker-version-log": [projectId: string, workerVersionId: string]
}

const eventSchemas = {
  "project-unlock-state": projectUnlockStateSchema,
  "instance-state": instanceStateEventSchema,
  "instance-lock": instanceLockEventSchema,
  "project-model": projectModelEventSchema,
  operation: operationEventSchema,
  "active-terminal-session": terminalSessionOutputSchema,
  "operation-instance-log": z.custom<OperationLog>(),
  "worker-unit-registration": workerUnitRegistrationEventSchema,
  "worker-version-log": z.custom<WorkerVersionLog>(),
}

type PubSubEventSchemas = typeof eventSchemas

export class PubSubManager {
  constructor(
    private readonly pubsubBackend: PubSubBackend,
    private readonly logger: Logger,
  ) {}

  /**
   * Subscribes to a specific topic in the pubsub backend.
   *
   * Stops the iteration if the provided signal is aborted and resumes the control flow of the caller without throwing an error.
   *
   * Will throw an error if the subscription fails to initialize.
   *
   * @param key The event key tuple.
   * @param signal The signal to abort the subscription.
   */
  public async subscribe<K extends keyof PubSubEventMap>(
    key: [type: K, ...PubSubEventMap[K]],
    signal?: AbortSignal,
  ): Promise<AsyncIterable<z.infer<PubSubEventSchemas[K]>>> {
    const topic = key.join(":")
    const schema = eventSchemas[key[0]]

    const subscription = await this.pubsubBackend.subscribe(topic, schema, signal)

    return this.listen(subscription, signal)
  }

  private async *listen<TEvent>(
    subscription: AsyncIterable<unknown>,
    signal?: AbortSignal,
  ): AsyncIterable<TEvent> {
    try {
      for await (const event of subscription) {
        yield event as TEvent
      }
    } catch (error) {
      if (signal?.aborted) {
        return
      }

      throw error
    }
  }

  /**
   * Publishes an event to the pubsub backend.
   *
   * Will never throw an error.
   *
   * @param key The event key tuple.
   * @param message The message to publish.
   */
  public async publish<K extends keyof PubSubEventMap>(
    key: readonly [type: K, ...PubSubEventMap[K]],
    message: z.infer<PubSubEventSchemas[K]>,
  ): Promise<void> {
    const topic = key.join(":")

    try {
      const schema = eventSchemas[key[0]]
      await this.pubsubBackend.publish(topic, schema, message)
    } catch (error) {
      this.logger.error({ error }, `failed to publish event to topic "%s"`, topic)
    }
  }

  /**
   * Publishes multiple events to the pubsub backend.
   *
   * @param events An array of events to publish, each containing the event key and message.
   */
  public async publishMany<K extends keyof PubSubEventMap>(
    events: readonly (readonly [
      readonly [type: K, ...PubSubEventMap[K]],
      z.infer<PubSubEventSchemas[K]>,
    ])[],
  ): Promise<void> {
    const promises = events.map(([key, message]) => this.publish(key, message))

    await Promise.all(promises)
  }
}
