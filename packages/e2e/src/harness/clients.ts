import { createClient } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import {
  InstanceStateService,
  LibraryService,
  OperationService,
  ProjectModelService,
  ProjectService,
  RuntimeSettingsService,
} from "@highstate/api/v1"

/** Uses authenticated network clients for all product workflow mutations and observations. */
export function createClients(url: string, token: string) {
  const transport = createConnectTransport({
    baseUrl: url,
    httpVersion: "1.1",
    interceptors: [
      next => async request => {
        request.header.set("authorization", `Bearer ${token}`)
        return await next(request)
      },
    ],
    defaultTimeoutMs: 180_000,
  })
  return {
    project: createClient(ProjectService, transport),
    model: createClient(ProjectModelService, transport),
    library: createClient(LibraryService, transport),
    operation: createClient(OperationService, transport),
    state: createClient(InstanceStateService, transport),
    runtime: createClient(RuntimeSettingsService, transport),
  }
}
export type Clients = ReturnType<typeof createClients>
