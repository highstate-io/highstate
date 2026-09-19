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

export function humanTable(headers: string[], rows: unknown[][], empty: string): string {
  if (rows.length === 0) {
    return empty
  }

  const values = [headers, ...rows].map(row => row.map(formatTableValue))
  const widths = headers.map((_, index) =>
    Math.max(...values.map(row => visibleLength(row[index] ?? ""))),
  )

  return values
    .map(row =>
      row
        .map((value, index) => (index === row.length - 1 ? value : value.padEnd(widths[index]!)))
        .join("  ")
        .trimEnd(),
    )
    .join("\n")
}

export function humanDetails(value: unknown): string {
  return formatDetails(value, 0).join("\n")
}

function formatTableValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "<none>"
  }

  if (Array.isArray(value)) {
    return value.length ? value.map(formatTableValue).join(",") : "<none>"
  }

  if (typeof value === "object") {
    return JSON.stringify(value)
  }

  const text = String(value).replace(
    /^(?:COMPONENT_KIND|INSTANCE_SOURCE|INSTANCE_STATUS|EVALUATION_STATUS|INSTANCE_OPERATION_STATUS|OPERATION_TYPE|OPERATION_STATUS|OPERATION_PHASE_TYPE)_/,
    "",
  )

  return text.replaceAll(/\r?\n/g, "\\n")
}

function visibleLength(value: string): number {
  return [...value].length
}

function formatDetails(value: unknown, depth: number): string[] {
  const indent = "  ".repeat(depth)

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${indent}<none>`]
    }

    return value.flatMap(item => {
      if (item !== null && typeof item === "object") {
        const lines = formatDetails(item, depth + 1)
        const first = lines.shift() ?? `${"  ".repeat(depth + 1)}<none>`

        return [`${indent}- ${first.trimStart()}`, ...lines]
      }

      return [`${indent}- ${formatTableValue(item)}`]
    })
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, entry]) => !isEmptyDetailValue(entry))
    if (entries.length === 0) {
      return [`${indent}<none>`]
    }

    return entries.flatMap(([key, entry]) => {
      const label = key
        .replaceAll("_", " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/^./, character => character.toUpperCase())
        .replace(/\b(Id|Api|Url|Fqdn)\b/g, value => value.toUpperCase())

      if (entry !== null && typeof entry === "object") {
        return [`${indent}${label}:`, ...formatDetails(entry, depth + 1)]
      }

      if (typeof entry === "string" && entry.includes("\n")) {
        return [
          `${indent}${label}:`,
          ...entry.split(/\r?\n/).map(line => `${"  ".repeat(depth + 1)}${line || " "}`),
        ]
      }

      return [`${indent}${label}: ${formatTableValue(entry)}`]
    })
  }

  return [`${indent}${formatTableValue(value)}`]
}

function isEmptyDetailValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true
  }

  if (Array.isArray(value)) {
    return value.length === 0
  }

  return typeof value === "object" && Object.keys(value).length === 0
}

export function writeOutput(value: unknown, format: OutputFormat, human?: string): void {
  if (format === "human") {
    process.stdout.write(`${human ?? humanDetails(value)}\n`)
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
