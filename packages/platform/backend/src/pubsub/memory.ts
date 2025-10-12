import type { Logger } from "pino"
import type { z } from "zod"
import type { PubSubBackend } from "./abstractions"
import { EventEmitter, on } from "node:events"

export class MemoryPubSubBackend implements PubSubBackend {
  private readonly eventEmitter = new EventEmitter()

  constructor(private readonly logger: Logger) {}

  async subscribe(
    topic: string,
    _schema: z.ZodType,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<unknown>> {
    return this.listen(topic, signal)
  }

  private async *listen(topic: string, signal?: AbortSignal): AsyncIterable<unknown> {
    for await (const [event] of on(this.eventEmitter, topic, { signal })) {
      yield event
    }
  }

  publish(topic: string, _schema: z.ZodType, message: unknown): Promise<void> {
    this.eventEmitter.emit(topic, message)
    this.logger.trace({ topic, message }, "published message to topic")

    return Promise.resolve()
  }
}
