import { readFile } from "node:fs/promises"
import { type DescMessage, type MessageShape, toJson } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import {
  BadRequestSchema,
  ErrorInfoSchema,
  PreconditionFailureSchema,
  RequestInfoSchema,
  RetryInfoSchema,
} from "@highstate/api/v1"
import { parse, stringify } from "yaml"

export type OutputFormat = "human" | "json" | "yaml"

export async function readDocument(path: string): Promise<unknown> {
  const content = path === "-" ? await Bun.stdin.text() : await readFile(path, "utf8")

  try {
    return parse(content)
  } catch (error) {
    throw new Error(`Failed to parse input document "${path}"`, { cause: error })
  }
}

export function messageJson<Desc extends DescMessage>(
  schema: Desc,
  message: MessageShape<Desc>,
): unknown {
  return toJson(schema, message, { useProtoFieldName: true })
}

export function writeOutput(value: unknown, format: OutputFormat, human?: string): void {
  if (format === "human") {
    process.stdout.write(`${human ?? stringify(value, { lineWidth: 0 }).trimEnd()}\n`)
    return
  }

  if (format === "json") {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
    return
  }

  process.stdout.write(`${stringify(value, { lineWidth: 0 }).trimEnd()}\n`)
}

export function formatRemoteError(error: unknown): { error: Record<string, unknown> } {
  if (!(error instanceof ConnectError)) {
    return {
      error: { code: "unknown", message: error instanceof Error ? error.message : String(error) },
    }
  }

  const code = Code[error.code]?.replace(/[A-Z]/g, (character, index) =>
    index === 0 ? character.toLowerCase() : `_${character.toLowerCase()}`,
  )
  const errorInfo = error.findDetails(ErrorInfoSchema)[0]
  const badRequest = error.findDetails(BadRequestSchema)[0]
  const precondition = error.findDetails(PreconditionFailureSchema)[0]
  const retry = error.findDetails(RetryInfoSchema)[0]
  const request = error.findDetails(RequestInfoSchema)[0]

  return {
    error: {
      code,
      message: error.rawMessage,
      ...(errorInfo?.reason ? { reason: errorInfo.reason } : {}),
      ...(errorInfo?.metadata ? { metadata: errorInfo.metadata } : {}),
      ...(badRequest
        ? {
            field_violations: badRequest.fieldViolations.map(value => ({
              field: value.field,
              reason: value.reason,
              description: value.description,
            })),
          }
        : {}),
      ...(precondition
        ? {
            precondition_violations: precondition.violations.map(value => ({
              type: value.type,
              subject: value.subject,
              description: value.description,
            })),
          }
        : {}),
      ...(retry ? { retry: toJson(RetryInfoSchema, retry, { useProtoFieldName: true }) } : {}),
      ...(request?.requestId || error.metadata.get("x-request-id")
        ? { request_id: request?.requestId || error.metadata.get("x-request-id") }
        : {}),
    },
  }
}
