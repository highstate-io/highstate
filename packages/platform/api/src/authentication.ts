import type { Interceptor } from "@connectrpc/connect"

export function createAuthenticationInterceptor(apiKey: string): Interceptor {
  return next => async request => {
    request.header.set("authorization", `Bearer ${apiKey}`)

    return await next(request)
  }
}
