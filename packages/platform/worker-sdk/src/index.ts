import type { PanelHttpRequestInterceptor } from "./panel"
import { EventEmitter } from "node:events"
import { createInterface } from "node:readline/promises"
import { createAuthenticationMiddleware } from "@highstate/api"
import { PanelServiceDefinition } from "@highstate/api/panel.v1"
import { WorkerServiceDefinition } from "@highstate/api/worker.v1"
import {
  type CommonObjectMeta,
  type ServiceAccountMeta,
  type WorkerRunOptions,
  workerRunOptionsSchema,
  type z,
} from "@highstate/contract"
import {
  type Channel,
  type ClientFactory,
  type CompatServiceDefinition,
  createChannel,
  createClientFactory,
} from "nice-grpc"
import { PanelDataServer, PanelTargetRegistry } from "./panel"

export * from "./panel"

export type RegistrationHandler<TParamsSchema extends z.ZodType> = (
  instanceId: string,
  params: z.infer<TParamsSchema>,
) => Promise<void> | void

export type DeregistrationHandler = (instanceId: string) => Promise<void> | void

export type WorkerPanel = {
  interceptHttpRequest?: PanelHttpRequestInterceptor
  name: string
  meta: CommonObjectMeta
  target: string
}

export type WorkerOptions<TParamsSchema extends z.ZodType = z.ZodType> = {
  workerMeta: CommonObjectMeta
  serviceAccountMeta: ServiceAccountMeta
  paramsSchema: TParamsSchema
}

export class Worker<TParamsSchema extends z.ZodType> {
  private readonly eventEmitter = new EventEmitter()
  private readonly clientFactory: ClientFactory
  private readonly channel: Channel
  private readonly panelTargets = new PanelTargetRegistry()
  private readonly panelDataServer = new PanelDataServer(this.panelTargets)

  private constructor(
    private readonly options: WorkerOptions<TParamsSchema>,
    private readonly runOptions: WorkerRunOptions,
  ) {
    const authMiddleware = createAuthenticationMiddleware(runOptions.apiKey, runOptions.projectId)

    this.clientFactory = createClientFactory().use(authMiddleware)
    this.channel = createChannel(runOptions.apiUrl)
  }

  onUnitRegistration(handler: RegistrationHandler<TParamsSchema>) {
    const handle = async (stateId: string, params: unknown) => {
      try {
        const parsedParams = this.options.paramsSchema.parse(params)

        await handler(stateId, parsedParams)
      } catch (error) {
        console.error(`Error handling unit registration for instance ${stateId}:`, error)
      }
    }

    this.eventEmitter.on(
      "unitRegistration",
      (instanceId: string, params: TParamsSchema) => void handle(instanceId, params),
    )
  }

  onUnitDeregistration(handler: DeregistrationHandler) {
    const handle = async (stateId: string) => {
      try {
        await handler(stateId)
      } catch (error) {
        console.error(`Error handling unit deregistration for instance ${stateId}:`, error)
      }
    }

    this.eventEmitter.on("unitDeregistration", (instanceId: string) => void handle(instanceId))
  }

  createClient<TService extends CompatServiceDefinition>(definition: TService) {
    return this.clientFactory.create(definition, this.channel)
  }

  /**
   * Replaces all panels served by this worker for a unit instance.
   *
   * Calling this method with an empty array removes all panels owned by this worker from the unit.
   *
   * @param stateId The ID of the unit state.
   * @param panels The complete set of panels currently served for the unit.
   * @returns Stable panel IDs in the same order as the supplied panels.
   */
  async setUnitPanels(stateId: string, panels: WorkerPanel[]): Promise<string[]> {
    const targets = this.panelTargets.prepare(panels)
    await this.panelTargets.waitUntilReady(targets)

    const panelClient = this.createClient(PanelServiceDefinition)
    const response = await panelClient.setUnitPanels({
      workerVersionId: this.runOptions.workerVersionId,
      workerInstanceId: this.runOptions.workerInstanceId,
      stateId,
      panels: panels.map(({ name, meta }) => ({ name, meta })),
    })

    this.panelTargets.apply(stateId, targets)

    return response.panelIds
  }

  async start(): Promise<void> {
    const workerClient = this.createClient(WorkerServiceDefinition)
    await workerClient.updateWorkerVersionMeta({
      workerVersionId: this.runOptions.workerVersionId,
      meta: {
        workerMeta: this.options.workerMeta,
        serviceAccountMeta: this.options.serviceAccountMeta,
      },
    })

    this.panelDataServer.start()

    for await (const { event } of workerClient.connect({
      workerVersionId: this.runOptions.workerVersionId,
      workerInstanceId: this.runOptions.workerInstanceId,
      dataEndpoint: this.runOptions.dataEndpoint,
    })) {
      switch (event?.$case) {
        case "unitRegistration": {
          this.eventEmitter.emit(
            "unitRegistration",
            event.value.stateId,
            event.value.params as TParamsSchema,
          )
          break
        }
        case "unitDeregistration": {
          this.eventEmitter.emit("unitDeregistration", event.value.stateId)
          break
        }
      }
    }
  }

  /**
   * Creates a new worker and connects it to the Highstate platform.
   *
   * @param metadata The metadata of the worker version to update.
   * @param paramsSchema The Zod schema of the parameters accepted by the worker on each unit registration.
   */
  static async create<TParamsSchema extends z.ZodType>(
    options: WorkerOptions<TParamsSchema>,
  ): Promise<Worker<TParamsSchema>> {
    let runOptionsJson: unknown
    for await (const line of createInterface({ input: process.stdin })) {
      try {
        runOptionsJson = JSON.parse(line)
      } catch (error) {
        throw new Error("Failed to parse worker run options", { cause: error })
      }

      break
    }

    if (!runOptionsJson) {
      throw new Error("No worker run options provided")
    }

    let runOptions: WorkerRunOptions
    try {
      runOptions = workerRunOptionsSchema.parse(runOptionsJson)
    } catch (error) {
      throw new Error("Invalid worker run options", { cause: error })
    }

    return new Worker(options, runOptions)
  }
}
