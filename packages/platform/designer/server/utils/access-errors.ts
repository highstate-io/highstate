import { BackendError, BackendErrorCategory } from "@highstate/backend/shared"
import { TRPCError } from "@trpc/server"

export function accessRejection(error: unknown): TRPCError | undefined {
  if (!(error instanceof BackendError)) {
    return undefined
  }

  if (error.category === BackendErrorCategory.PermissionDenied) {
    return new TRPCError({ code: "FORBIDDEN", cause: error })
  }

  if (error.category === BackendErrorCategory.Unauthenticated) {
    return new TRPCError({ code: "UNAUTHORIZED", cause: error })
  }

  return undefined
}
