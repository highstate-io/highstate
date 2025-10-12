import { type CallOptions, type ClientMiddlewareCall, Metadata } from "nice-grpc-common"

export function createAuthenticationMiddleware(apiKey: string, projectId?: string) {
  return async function* authenticationMiddleware<TRequest, TResponse>(
    call: ClientMiddlewareCall<TRequest, TResponse>,
    options: CallOptions,
  ): AsyncGenerator<TResponse> {
    const metadata = Metadata(options.metadata).set("api-key", apiKey)

    if (projectId) {
      metadata.set("project-id", projectId)
    }

    return yield* call.next(call.request, {
      ...options,
      metadata,
    })
  }
}
