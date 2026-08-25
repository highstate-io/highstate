import type { z } from "zod"
import { Code } from "@connectrpc/connect"
import { createApiError } from "./api-error"

/**
 * Parses and validates a named request argument.
 *
 * @param request The request containing the argument.
 * @param argumentName The name of the argument to validate.
 * @param schema The schema used to validate the argument.
 * @returns The validated argument value.
 */
export function parseArgument<
  TRequest,
  TArgumentName extends string & keyof TRequest,
  TSchema extends z.ZodType,
>(request: TRequest, argumentName: TArgumentName, schema: TSchema): z.infer<TSchema> {
  const result = schema.safeParse(request[argumentName])
  if (!result.success) {
    throw validationError(`Invalid argument "${argumentName}"`, argumentName, result.error)
  }

  return result.data
}

/**
 * Parses and validates an arbitrary value.
 *
 * @param value The value to validate.
 * @param name The name used in validation errors.
 * @param schema The schema used to validate the value.
 * @returns The validated value.
 */
export function parseValue<TSchema extends z.ZodType>(
  value: unknown,
  name: string,
  schema: TSchema,
): z.infer<TSchema> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw validationError(`Invalid ${name}`, name, result.error)
  }

  return result.data
}

function validationError(message: string, field: string, error: z.ZodError) {
  return createApiError({
    message,
    code: Code.InvalidArgument,
    reason: "REQUEST_INVALID",
    fieldViolations: error.issues.map(issue => ({
      field: [field, ...issue.path.map(String)].join("."),
      reason: issue.code.toUpperCase(),
      description: issue.message,
    })),
  })
}
