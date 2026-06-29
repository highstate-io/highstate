import type { RawPulumiOutputs } from "./abstractions"
import type { SidecarTracker } from "./sidecar-tracker"
import { randomUUID } from "node:crypto"
import {
  type InstanceId,
  runtimeConfigGetOutputSchema,
  runtimeResultSubmitInputSchema,
  runtimeSidecarStartInputSchema,
} from "@highstate/contract"
import { initTRPC, TRPCError } from "@trpc/server"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { getPort } from "get-port-please"

export const highstateRuntimeEndpointEnvVar = "HIGHSTATE_RUNTIME_ENDPOINT"
export const highstateRuntimeTokenEnvVar = "HIGHSTATE_RUNTIME_TOKEN"

type RuntimeContext = {
  token: string
  operationId: string
  unitId: InstanceId
}

type RuntimeTokenState = {
  operationId: string
  unitId: InstanceId
  config: unknown
  outputs?: RawPulumiOutputs
}

const t = initTRPC.context<RuntimeContext>().create()

export class LocalRuntimeServer {
  private readonly tokenMap = new Map<string, RuntimeTokenState>()

  private constructor(
    readonly port: number,
    private readonly server: Bun.Server<undefined>,
    private readonly sidecarTracker: SidecarTracker,
  ) {}

  get endpoint(): string {
    return `http://localhost:${this.port}/trpc`
  }

  static async create(sidecarTracker: SidecarTracker): Promise<LocalRuntimeServer> {
    const port = await getPort({ random: true })
    let instance: LocalRuntimeServer | undefined

    const appRouter = t.router({
      config: t.router({
        get: t.procedure.query(({ ctx }) => {
          const state = instance!.tokenMap.get(ctx.token)
          if (!state) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Config not found" })
          }

          return runtimeConfigGetOutputSchema.parse(state.config)
        }),
      }),

      result: t.router({
        submit: t.procedure.input(runtimeResultSubmitInputSchema).mutation(({ ctx, input }) => {
          const state = instance!.tokenMap.get(ctx.token)
          if (!state) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Runtime token not found" })
          }

          state.outputs = LocalRuntimeServer.wrapOutputs(input)

          return {}
        }),
      }),

      sidecar: t.router({
        start: t.procedure
          .input(runtimeSidecarStartInputSchema)
          .mutation(async ({ ctx, input }) => {
            return await instance!.sidecarTracker.startSidecar(ctx.operationId, ctx.unitId, input)
          }),
      }),
    })

    const server = Bun.serve({
      port,
      hostname: "localhost",
      fetch: request => {
        return fetchRequestHandler({
          endpoint: "/trpc",
          req: request,
          router: appRouter,
          createContext: ({ req }) => {
            const authorization = req.headers.get("authorization")
            if (!authorization?.startsWith("Bearer ")) {
              throw new TRPCError({ code: "UNAUTHORIZED", message: "Unauthorized" })
            }

            const token = authorization.slice("Bearer ".length)
            const state = instance?.tokenMap.get(token)
            if (!state) {
              throw new TRPCError({ code: "UNAUTHORIZED", message: "Unauthorized" })
            }

            return { token, operationId: state.operationId, unitId: state.unitId }
          },
        })
      },
    })

    instance = new LocalRuntimeServer(port, server, sidecarTracker)
    return instance
  }

  setConfig(operationId: string, unitId: InstanceId, config: unknown): string {
    const token = randomUUID()
    this.tokenMap.set(token, { operationId, unitId, config })

    return token
  }

  getSubmittedOutputs(token: string): RawPulumiOutputs {
    return this.tokenMap.get(token)?.outputs ?? {}
  }

  deleteConfig(token: string): void {
    this.tokenMap.delete(token)
  }

  stop(): void {
    this.server.stop(true)
    this.tokenMap.clear()
  }

  private static wrapOutputs(outputs: Record<string, unknown>): RawPulumiOutputs {
    return Object.fromEntries(
      Object.entries(outputs).map(([name, value]) => [name, { value }]),
    ) as RawPulumiOutputs
  }
}
