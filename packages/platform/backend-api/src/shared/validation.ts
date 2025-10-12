import type { z } from "zod"
import { ServerError, Status } from "nice-grpc-common"

export function parseArgument<
  TRequest,
  TArgumentName extends string & keyof TRequest,
  TSchema extends z.ZodType,
>(request: TRequest, argumentName: TArgumentName, schema: TSchema): z.infer<TSchema> {
  const result = schema.safeParse(request[argumentName])
  if (!result.success) {
    throw new ServerError(
      Status.INVALID_ARGUMENT,
      `Invalid argument "${argumentName}": ${result.error.message}`,
    )
  }

  return result.data
}
