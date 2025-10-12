import type { Services } from "@highstate/backend"
import { AccessError } from "@highstate/backend/shared"
import { isAbortError } from "abort-controller-x"
import { type CallContext, ServerError, type ServerMiddlewareCall, Status } from "nice-grpc-common"

export function createErrorHandlingMiddleware(services: Services) {
  return async function* errorHandlingMiddleware<TRequest, TResponse>(
    call: ServerMiddlewareCall<TRequest, TResponse>,
    context: CallContext,
  ) {
    try {
      return yield* call.next(call.request, context)
    } catch (error) {
      if (error instanceof ServerError || isAbortError(error)) {
        throw error
      }

      if (error instanceof AccessError) {
        services.logger.info({ error }, "access denied")
        throw new ServerError(Status.UNAUTHENTICATED, "Access denied")
      }

      services.logger.error({ error }, "unexpected error")
      throw new ServerError(Status.INTERNAL, "An unexpected error occurred")
    }
  }
}
