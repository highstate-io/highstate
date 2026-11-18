import { type Client, createClient, type Interceptor } from "@connectrpc/connect"
import { createApiTransport, createAuthenticationInterceptor } from "@highstate/api"
import {
  InstanceStateService,
  LibraryService,
  OperationService,
  ProjectModelService,
  ProjectService,
  SecretService,
} from "@highstate/api/v1"

export type HighstateClients = {
  secret: Client<typeof SecretService>
  instanceState: Client<typeof InstanceStateService>
  library: Client<typeof LibraryService>
  operation: Client<typeof OperationService>
  projectModel: Client<typeof ProjectModelService>
  project: Client<typeof ProjectService>
}

export function createHighstateClients(apiUrl: string, apiToken: string): HighstateClients {
  const errors: Interceptor = next => async request => await next(request)
  const transport = createApiTransport(apiUrl, [createAuthenticationInterceptor(apiToken), errors])

  return {
    secret: createClient(SecretService, transport),
    instanceState: createClient(InstanceStateService, transport),
    library: createClient(LibraryService, transport),
    operation: createClient(OperationService, transport),
    projectModel: createClient(ProjectModelService, transport),
    project: createClient(ProjectService, transport),
  }
}
