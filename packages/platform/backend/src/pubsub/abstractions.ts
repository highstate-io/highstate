import type { z } from "zod"

export interface PubSubBackend {
  /**
   * Subscribes to a topic and returns an async iterator for the messages.
   *
   * @param topic The topic to subscribe to.
   * @param schema The schema to validate the messages against.
   * @param signal An optional AbortSignal to cancel the subscription.
   * @return A promise that resolves to an async iterable of messages. When promise is resolved, the subscription is active.
   */
  subscribe(topic: string, schema: z.ZodType, signal?: AbortSignal): Promise<AsyncIterable<unknown>>

  /**
   * Publishes a message to a topic.
   *
   * @param topic The topic to publish to.
   * @param schema The schema to validate the message against.
   * @param message The message to publish.
   */
  publish(topic: string, schema: z.ZodType, message: unknown): Promise<void>
}
