import { toJson } from "@bufbuild/protobuf"
import {
  type Client,
  Code,
  ConnectError,
  createClient,
  type Interceptor,
} from "@connectrpc/connect"
import { createApiTransport, createAuthenticationInterceptor } from "@highstate/api"
import {
  BadRequestSchema,
  ErrorInfoSchema,
  InstanceStateService,
  LibraryService,
  OperationService,
  PreconditionFailureSchema,
  ProjectModelService,
  ProjectService,
  RequestInfoSchema,
  RetryInfoSchema,
} from "@highstate/api/v1"
import { stringify } from "yaml"

export type HighstateCredentials = {
  apiToken: string
}

export type HighstateClients = {
  instanceState: Client<typeof InstanceStateService>
  library: Client<typeof LibraryService>
  operation: Client<typeof OperationService>
  projectModel: Client<typeof ProjectModelService>
  project: Client<typeof ProjectService>
}

export function createHighstateClients(
  apiUrl: string,
  credentials: HighstateCredentials,
): HighstateClients {
  const authenticationInterceptor = createAuthenticationInterceptor(credentials.apiToken)
  const transport = createApiTransport(apiUrl, [authenticationInterceptor, errorInterceptor])

  return {
    instanceState: createClient(InstanceStateService, transport),
    library: createClient(LibraryService, transport),
    operation: createClient(OperationService, transport),
    projectModel: createClient(ProjectModelService, transport),
    project: createClient(ProjectService, transport),
  }
}

const errorInterceptor: Interceptor = next => async request => {
  try {
    return await next(request)
  } catch (error) {
    throw new Error(
      `Highstate API request failed\n${formatClientError(error, request.method.name, request.url)}`,
      { cause: error },
    )
  }
}

export function formatClientError(error: unknown, method: string, url: string): string {
  if (!(error instanceof ConnectError)) {
    return stringify({
      rpc: { method, url },
      error: serializeError(error),
    }).trimEnd()
  }

  return stringify({
    rpc: { method, url },
    connect: {
      code: codeName(error.code),
      code_number: error.code,
      message: error.rawMessage,
      metadata: Object.fromEntries(error.metadata.entries()),
      details: [
        ...error.findDetails(ErrorInfoSchema).map(detail => ({
          type: ErrorInfoSchema.typeName,
          value: toJson(ErrorInfoSchema, detail, { useProtoFieldName: true }),
        })),
        ...error.findDetails(BadRequestSchema).map(detail => ({
          type: BadRequestSchema.typeName,
          value: toJson(BadRequestSchema, detail, { useProtoFieldName: true }),
        })),
        ...error.findDetails(PreconditionFailureSchema).map(detail => ({
          type: PreconditionFailureSchema.typeName,
          value: toJson(PreconditionFailureSchema, detail, { useProtoFieldName: true }),
        })),
        ...error.findDetails(RetryInfoSchema).map(detail => ({
          type: RetryInfoSchema.typeName,
          value: toJson(RetryInfoSchema, detail, { useProtoFieldName: true }),
        })),
        ...error.findDetails(RequestInfoSchema).map(detail => ({
          type: RequestInfoSchema.typeName,
          value: toJson(RequestInfoSchema, detail, { useProtoFieldName: true }),
        })),
      ],
      raw_details: error.details.map(detail =>
        "type" in detail
          ? {
              type: detail.type,
              value_base64: Buffer.from(detail.value).toString("base64"),
              debug: detail.debug,
            }
          : {
              type: detail.desc.typeName,
              value: detail.value,
            },
      ),
    },
    cause: serializeError(error.cause),
    stack: error.stack,
  }).trimEnd()
}

function codeName(code: Code): string {
  return Code[code]?.replace(/[A-Z]/g, (character, index) =>
    index === 0 ? character.toLowerCase() : `_${character.toLowerCase()}`,
  )
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: serializeError(error.cause),
    }
  }

  return error
}
