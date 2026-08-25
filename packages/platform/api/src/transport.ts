import type { Interceptor, Transport } from "@connectrpc/connect"
import { toBinary } from "@bufbuild/protobuf"
import { createConnectTransport } from "@connectrpc/connect-node"

const contentLengthInterceptor: Interceptor = next => async request => {
  if (!request.stream) {
    request.header.set(
      "content-length",
      String(toBinary(request.method.input, request.message).byteLength),
    )
  }

  return await next(request)
}

export function createApiTransport(apiUrl: string, interceptors: Interceptor[] = []): Transport {
  const url = new URL(apiUrl)
  if (url.protocol !== "unix:") {
    return createConnectTransport({
      baseUrl: apiUrl,
      httpVersion: "1.1",
      interceptors: [contentLengthInterceptor, ...interceptors],
    })
  }

  return createConnectTransport({
    baseUrl: "http://localhost",
    httpVersion: "1.1",
    interceptors,
    nodeOptions: { socketPath: url.pathname },
  })
}
