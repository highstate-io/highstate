import type { BackendPermission, ProjectPermission } from "@highstate/backend/shared"
import type { InstanceId } from "@highstate/contract"
import { reactive, ref, shallowRef } from "vue"

export type AccessRequirement = {
  permission: BackendPermission | ProjectPermission
  projectId?: string
  collection?: boolean
  target?: {
    artifactHash?: string
    resourceId?: string
    instanceId?: InstanceId
    ancestorInstanceIds?: InstanceId[]
    ownerServiceAccountId?: string
    workerId?: string
    projectId?: string
    projectSpaceId?: string
  }
}
export type AccessStatus = { allowed: boolean; reason: string; pending?: boolean }
export type AccessRejection = {
  message: string
  path: string
  projectId?: string
  unauthorized: boolean
}
export type AccessCheck = AccessRequirement & { key: string }
export type AccessController = ReturnType<typeof createAccessController>

export function accessError(
  error: unknown,
): { unauthorized: boolean; message: string } | undefined {
  if (!error || typeof error !== "object") {
    return undefined
  }

  const candidate = error as {
    data?: { code?: string; httpStatus?: number }
    statusCode?: number
    meta?: { response?: { status?: number } }
    message?: string
  }

  const unauthorized =
    candidate.data?.code === "UNAUTHORIZED" ||
    candidate.data?.httpStatus === 401 ||
    candidate.statusCode === 401 ||
    candidate.meta?.response?.status === 401

  const forbidden =
    candidate.data?.code === "FORBIDDEN" ||
    candidate.data?.httpStatus === 403 ||
    candidate.statusCode === 403 ||
    candidate.meta?.response?.status === 403

  if (!unauthorized && !forbidden) {
    return undefined
  }

  const permission = candidate.message?.match(/Permission "([a-z.-]+)" is required/)?.[1]
  return {
    unauthorized,
    message: unauthorized
      ? "Your session has expired. Sign in again to continue."
      : permission
        ? `You do not have permission to perform this action. Required permission: ${permission}.`
        : "You do not have permission to access this resource or perform this action.",
  }
}

export function createAccessController(
  check: (checks: AccessCheck[]) => Promise<{ key: string; allowed: boolean; reason?: string }[]>,
) {
  const requests = new Map<string, AccessCheck>()
  const statuses = reactive(new Map<string, AccessStatus>())
  const rejection = ref<AccessRejection>()
  const authenticated = ref(true)
  const revision = ref(0)
  const checks = shallowRef<AccessCheck[]>([])
  let scheduled = false
  let generation = 0

  const keyOf = (requirement: AccessRequirement) => JSON.stringify(requirement)

  const missing = (requirement: AccessRequirement) =>
    `You do not have permission to perform this action. Required permission: ${requirement.permission}${requirement.projectId ? " in this project" : ""}.`

  async function flush(): Promise<void> {
    scheduled = false
    const current = generation
    const pending = [...requests.values()].filter(request => statuses.get(request.key)?.pending)
    if (!pending.length) {
      return
    }

    try {
      const result = await check(pending)

      if (generation !== current) {
        return
      }

      for (const request of pending) {
        const allowed = result.find(item => item.key === request.key)?.allowed === true

        statuses.set(request.key, {
          allowed,
          reason: allowed
            ? ""
            : (result.find(item => item.key === request.key)?.reason ?? missing(request)),
        })
      }
    } catch (error) {
      if (generation !== current) {
        return
      }

      const denial = accessError(error)
      if (denial?.unauthorized) {
        authenticated.value = false
      }

      for (const request of pending) {
        statuses.set(request.key, {
          allowed: false,
          reason:
            denial?.message ?? "Permissions could not be checked. Reconnecting automatically…",
        })
      }
    }
  }

  async function recheck(): Promise<void> {
    const current = generation
    const pending = [...requests.values()]
    if (!pending.length || !authenticated.value) {
      return
    }

    try {
      const result = await check(pending)

      if (generation !== current) {
        return
      }

      let changed = false

      for (const request of pending) {
        const allowed = result.find(item => item.key === request.key)?.allowed === true
        if (!statuses.get(request.key)?.pending && statuses.get(request.key)?.allowed !== allowed) {
          changed = true
        }

        statuses.set(request.key, {
          allowed,
          reason: allowed
            ? ""
            : (result.find(item => item.key === request.key)?.reason ?? missing(request)),
        })
      }

      if (changed) {
        revision.value++
      }
    } catch (error) {
      reject(error, "access refresh")
    }
  }

  function schedule(): void {
    if (scheduled) {
      return
    }

    scheduled = true

    queueMicrotask(() => {
      void flush()
    })
  }

  function status(requirement: AccessRequirement | AccessRequirement[]): AccessStatus {
    if (Array.isArray(requirement)) {
      const results = requirement.map(status)
      return results.find(result => !result.allowed) ?? { allowed: true, reason: "" }
    }

    if (!authenticated.value) {
      return { allowed: false, reason: "Your session has expired. Sign in again to continue." }
    }

    const key = keyOf(requirement)
    if (!statuses.has(key)) {
      requests.set(key, { ...requirement, key })
      checks.value = [...requests.values()]
      statuses.set(key, { allowed: false, pending: true, reason: "Checking permissions…" })
      schedule()
    }

    return statuses.get(key)!
  }

  function reject(error: unknown, path: string, input?: unknown, announce = true): boolean {
    const denial = accessError(error)
    if (!denial) {
      return false
    }

    const projectId =
      input &&
      typeof input === "object" &&
      "projectId" in input &&
      typeof input.projectId === "string"
        ? input.projectId
        : undefined

    if (announce || denial.unauthorized) {
      rejection.value = { ...denial, path, projectId }
    }

    if (denial.unauthorized) {
      authenticated.value = false
    }

    const permission =
      error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message.match(/Permission "([a-z.-]+)" is required/)?.[1]
        : undefined

    const values =
      input && typeof input === "object"
        ? Object.entries(input)
            .filter(([key]) => key !== "projectId" && (key.endsWith("Id") || key === "instanceIds"))
            .flatMap(([, value]) =>
              typeof value === "string"
                ? [value]
                : Array.isArray(value)
                  ? value.filter((id): id is string => typeof id === "string")
                  : [],
            )
        : []

    for (const request of requests.values()) {
      const target = request.target?.resourceId ?? request.target?.instanceId
      if (
        request.projectId === projectId &&
        request.permission === permission &&
        (!values.length || (target && values.includes(target)))
      ) {
        statuses.set(request.key, { allowed: false, reason: denial.message })
      }
    }

    return true
  }

  function requireAccess(requirement: AccessRequirement | AccessRequirement[]): void {
    const result = status(requirement)
    if (result.allowed) {
      return
    }

    const error = Object.assign(new Error(result.reason), {
      data: { code: authenticated.value ? "FORBIDDEN" : "UNAUTHORIZED" },
    })

    reject(error, "protected action", Array.isArray(requirement) ? requirement[0] : requirement)
    throw error
  }

  function explain(message: string): void {
    const permission = message.match(/Required permission: ([a-z.-]+)/)?.[1]

    const rejectedPermission = rejection.value?.message.match(
      /Required permission: ([a-z.-]+)/,
    )?.[1]

    if (
      !rejection.value?.unauthorized &&
      (rejection.value?.message === message || (permission && permission === rejectedPermission))
    ) {
      rejection.value = undefined
    }
  }

  function refresh(): void {
    generation++
    authenticated.value = true
    rejection.value = undefined
    revision.value++
    statuses.clear()

    for (const request of requests.values()) {
      statuses.set(request.key, { allowed: false, pending: true, reason: "Checking permissions…" })
    }

    schedule()
  }

  function apply(results: { key: string; allowed: boolean; reason?: string }[]): void {
    // A pushed snapshot supersedes one-shot checks already in flight.
    generation++
    let changed = false

    for (const result of results) {
      const request = requests.get(result.key)
      if (!request) {
        continue
      }

      if (
        !statuses.get(result.key)?.pending &&
        statuses.get(result.key)?.allowed !== result.allowed
      ) {
        changed = true
      }

      statuses.set(result.key, {
        allowed: result.allowed,
        reason: result.allowed ? "" : (result.reason ?? missing(request)),
      })
    }

    if (changed) {
      revision.value++

      if (!rejection.value?.unauthorized) {
        rejection.value = undefined
      }
    }
  }

  return {
    status,
    requireAccess,
    reject,
    explain,
    rejection,
    authenticated,
    revision,
    checks,
    apply,
    refresh,
    recheck,
    flush,
  }
}
