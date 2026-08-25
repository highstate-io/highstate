import type { GenMessage } from "@bufbuild/protobuf/codegenv2"
import { create, type Message } from "@bufbuild/protobuf"
import { type Code, ConnectError } from "@connectrpc/connect"
import { BadRequestSchema, ErrorInfoSchema } from "@highstate/api/v1"

export type ApiFieldViolation = {
  field: string
  reason: string
  description: string
}

type OutgoingDetail = { desc: GenMessage<Message>; value: Message }

export function createApiError(options: {
  message: string
  code: Code
  reason: string
  metadata?: Record<string, string>
  fieldViolations?: readonly ApiFieldViolation[]
}): ConnectError {
  const details: OutgoingDetail[] = [
    {
      desc: ErrorInfoSchema,
      value: create(ErrorInfoSchema, {
        reason: options.reason,
        domain: "highstate.io",
        metadata: options.metadata,
      }),
    },
  ]

  if (options.fieldViolations?.length) {
    details.push({
      desc: BadRequestSchema,
      value: create(BadRequestSchema, {
        fieldViolations: options.fieldViolations.map(violation => ({ ...violation })),
      }),
    })
  }

  return new ConnectError(options.message, options.code, undefined, details)
}
