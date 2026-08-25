import type { GenMessage } from "@bufbuild/protobuf/codegenv2"
import type { Services } from "@highstate/backend"
import { create, type Message } from "@bufbuild/protobuf"
import { durationFromMs } from "@bufbuild/protobuf/wkt"
import { Code, ConnectError, type Interceptor } from "@connectrpc/connect"
import {
  BadRequestSchema,
  ErrorInfoSchema,
  PreconditionFailureSchema,
  RequestInfoSchema,
  RetryInfoSchema,
} from "@highstate/api/v1"
import { BackendError, BackendErrorCategory } from "@highstate/backend/shared"
import { isAbortError } from "abort-controller-x"

const sensitiveMetadataKey = /credential|token|secret|encrypted|cause|stack|path/i

type OutgoingDetail = { desc: GenMessage<Message>; value: Message }

/**
 * Creates the interceptor that translates backend failures into API errors.
 *
 * @param services The backend services used for error logging.
 * @returns An interceptor that translates backend failures into API errors.
 */
export function createErrorHandlingInterceptor(services: Services): Interceptor {
  return next => async request => {
    try {
      return await next(request)
    } catch (error) {
      if (isAbortError(error) || (error instanceof ConnectError && error.code === Code.Canceled)) {
        throw error
      }

      if (error instanceof BackendError) {
        const code = categoryToCode(error.category)
        if (code === Code.Internal) {
          services.logger.error({ error, method: request.method.name }, "unexpected backend error")
          throw new ConnectError("An unexpected error occurred", Code.Internal)
        }

        throw new ConnectError(error.message, code, undefined, backendErrorDetails(error, request))
      }

      if (error instanceof ConnectError) {
        throw error
      }

      services.logger.error({ error, method: request.method.name }, "unexpected error")
      throw new ConnectError("An unexpected error occurred", Code.Internal)
    }
  }
}

function backendErrorDetails(
  error: BackendError,
  request: Parameters<Parameters<Interceptor>[0]>[0],
): OutgoingDetail[] {
  const details: OutgoingDetail[] = [
    {
      desc: ErrorInfoSchema,
      value: create(ErrorInfoSchema, {
        reason: error.reason,
        domain: "highstate.io",
        metadata: Object.fromEntries(
          Object.entries(error.metadata).filter(([key]) => !sensitiveMetadataKey.test(key)),
        ),
      }),
    },
  ]

  if (error.fieldViolations.length > 0) {
    details.push({
      desc: BadRequestSchema,
      value: create(BadRequestSchema, {
        fieldViolations: error.fieldViolations.map(violation => ({
          field: toProtobufPath(violation.field),
          reason: violation.reason,
          description: violation.description,
        })),
      }),
    })
  }

  if (error.preconditionViolations.length > 0) {
    details.push({
      desc: PreconditionFailureSchema,
      value: create(PreconditionFailureSchema, {
        violations: error.preconditionViolations.map(violation => ({ ...violation })),
      }),
    })
  }

  if (error.retry && Number.isFinite(error.retry.delayMs) && error.retry.delayMs >= 0) {
    details.push({
      desc: RetryInfoSchema,
      value: create(RetryInfoSchema, { retryDelay: durationFromMs(error.retry.delayMs) }),
    })
  }

  const requestId = request.header.get("x-request-id")?.trim()
  if (requestId) {
    details.push({
      desc: RequestInfoSchema,
      value: create(RequestInfoSchema, { requestId }),
    })
  }

  return details
}

function toProtobufPath(path: string): string {
  return path
    .split(".")
    .map(segment => segment.replace(/[A-Z]/g, character => `_${character.toLowerCase()}`))
    .join(".")
}

function categoryToCode(category: BackendErrorCategory): Code {
  switch (category) {
    case BackendErrorCategory.InvalidArgument:
      return Code.InvalidArgument
    case BackendErrorCategory.Unauthenticated:
      return Code.Unauthenticated
    case BackendErrorCategory.PermissionDenied:
      return Code.PermissionDenied
    case BackendErrorCategory.NotFound:
      return Code.NotFound
    case BackendErrorCategory.AlreadyExists:
      return Code.AlreadyExists
    case BackendErrorCategory.FailedPrecondition:
      return Code.FailedPrecondition
    case BackendErrorCategory.Aborted:
      return Code.Aborted
    case BackendErrorCategory.Unavailable:
      return Code.Unavailable
    case BackendErrorCategory.Internal:
      return Code.Internal
  }
}
