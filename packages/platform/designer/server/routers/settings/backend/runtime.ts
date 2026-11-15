import type { BackendRequestContext, RuntimeSettingsService } from "@highstate/backend"
import {
  containerRegistryCredentialInputSchema,
  containerRegistryCredentialOutputSchema,
  containerRuntimeInputSchema,
  containerRuntimeOutputSchema,
  npmRegistryCredentialInputSchema,
  npmRegistryCredentialOutputSchema,
  pulumiStateBackendInputSchema,
  pulumiStateBackendOutputSchema,
  RuntimeSettingsConflictError,
  RuntimeSettingsInUseError,
  runtimeSettingsKindSchema,
} from "@highstate/backend/shared"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { backendProcedure, router } from "../../../trpc"

const identity = z.object({ id: z.cuid2().length(24) })

const putInput = z.discriminatedUnion("kind", [
  identity.extend({ kind: z.literal("container-runtime"), value: containerRuntimeInputSchema }),
  identity.extend({
    kind: z.literal("pulumi-state-backend"),
    value: pulumiStateBackendInputSchema,
  }),
  identity.extend({
    kind: z.literal("npm-registry-credential"),
    value: npmRegistryCredentialInputSchema,
  }),
  identity.extend({
    kind: z.literal("container-registry-credential"),
    value: containerRegistryCredentialInputSchema,
  }),
])

function rethrowSettingsError(error: unknown): never {
  if (error instanceof RuntimeSettingsConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message, cause: error })
  }

  if (error instanceof RuntimeSettingsInUseError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message, cause: error })
  }

  throw error
}

const settingsSchema = z.object({
  runtimes: z.array(containerRuntimeOutputSchema),
  stateBackends: z.array(pulumiStateBackendOutputSchema),
  npmCredentials: z.array(npmRegistryCredentialOutputSchema),
  ociCredentials: z.array(containerRegistryCredentialOutputSchema),
})

async function listSettings(service: RuntimeSettingsService, context: BackendRequestContext) {
  const [runtimes, stateBackends, npmCredentials, ociCredentials] = await Promise.all([
    service.list(context, "container-runtime"),
    service.list(context, "pulumi-state-backend"),
    service.list(context, "npm-registry-credential"),
    service.list(context, "container-registry-credential"),
  ])

  return settingsSchema.parse({ runtimes, stateBackends, npmCredentials, ociCredentials })
}

export const runtimeSettingsRouter = router({
  list: backendProcedure
    .output(settingsSchema)
    .query(async ({ ctx }) => await listSettings(ctx.runtimeSettingsService, ctx.requestContext)),
  watch: backendProcedure.subscription(async function* ({ ctx, signal }) {
    const controller = new AbortController()

    const subscriptionSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal

    const changes = await ctx.pubsubManager.subscribe(["runtime-settings"], subscriptionSignal)
    const iterator = changes[Symbol.asyncIterator]()
    let next = iterator.next()

    try {
      yield await listSettings(ctx.runtimeSettingsService, ctx.requestContext)

      while (!signal?.aborted) {
        const change = await next
        if (change.done) {
          return
        }

        next = iterator.next()
        yield await listSettings(ctx.runtimeSettingsService, ctx.requestContext)
      }
    } finally {
      controller.abort()
      await iterator.return?.()
    }
  }),
  put: backendProcedure
    .input(putInput)
    .output(
      z.union([
        containerRuntimeOutputSchema,
        pulumiStateBackendOutputSchema,
        npmRegistryCredentialOutputSchema,
        containerRegistryCredentialOutputSchema,
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        switch (input.kind) {
          case "container-runtime":
            return await ctx.runtimeSettingsService.put(
              ctx.requestContext,
              input.kind,
              input.id,
              input.value,
            )
          case "pulumi-state-backend":
            return await ctx.runtimeSettingsService.put(
              ctx.requestContext,
              input.kind,
              input.id,
              input.value,
            )
          case "npm-registry-credential":
            return await ctx.runtimeSettingsService.put(
              ctx.requestContext,
              input.kind,
              input.id,
              input.value,
            )
          case "container-registry-credential":
            return await ctx.runtimeSettingsService.put(
              ctx.requestContext,
              input.kind,
              input.id,
              input.value,
            )
        }
      } catch (error) {
        rethrowSettingsError(error)
      }
    }),
  delete: backendProcedure
    .input(
      identity.extend({ kind: runtimeSettingsKindSchema, revision: z.number().int().positive() }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.runtimeSettingsService.delete(
          ctx.requestContext,
          input.kind,
          input.id,
          input.revision,
        )
      } catch (error) {
        rethrowSettingsError(error)
      }
    }),
  preflight: backendProcedure.input(identity).mutation(async ({ ctx, input, signal }) => {
    return await ctx.runtimeSettingsService.preflight(ctx.requestContext, input.id, signal)
  }),
})
