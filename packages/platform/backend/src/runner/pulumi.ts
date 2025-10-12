import type {
  ConfigMap,
  OpMap,
  OpType,
  Stack,
  WhoAmIResult,
} from "@pulumi/pulumi/automation/index.js"
import type { Logger } from "pino"
import type { SecretService } from "../business"
import { BetterLock } from "better-lock"
import { AbortError, errorToString, runWithRetryOnError } from "../common/utils"
import { createForceAbortableCommand } from "./force-abort"

export type RunOptions = {
  projectId: string
  pulumiProjectName: string
  pulumiStackName: string
  envVars?: Record<string, string>
}

export type RunLocalOptions = RunOptions & {
  projectPath: string
  stackConfig?: ConfigMap
}

export class LocalPulumiHost {
  private lock = new BetterLock()

  private constructor(
    private readonly secretService: SecretService,
    private readonly logger: Logger,
  ) {}

  async getCurrentUser(): Promise<WhoAmIResult | null> {
    const { LocalWorkspace } = await import("@pulumi/pulumi/automation/index.js")
    const workspace = await LocalWorkspace.create({})

    try {
      return await workspace.whoAmI()
    } catch (error) {
      this.logger.error({ msg: "failed to get current user", error })

      return null
    }
  }

  async runEmpty<T>(
    options: RunOptions,
    fn: (stack: Stack) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const { projectId, pulumiProjectName, pulumiStackName, envVars } = options

    return await this.lock.acquire(`${pulumiProjectName}.${pulumiStackName}`, async () => {
      const { LocalWorkspace } = await import("@pulumi/pulumi/automation/index.js")

      const stack = await LocalWorkspace.createOrSelectStack(
        {
          projectName: pulumiProjectName,
          stackName: pulumiStackName,
          program: () => Promise.resolve(),
        },
        {
          projectSettings: {
            name: pulumiProjectName,
            runtime: "nodejs",
          },
          envVars: {
            PULUMI_CONFIG_PASSPHRASE: await this.secretService.getPulumiPassword(projectId),
            PULUMI_K8S_AWAIT_ALL: "true",
            PULUMI_DEBUG_PROMISE_LEAKS: "true",
            ...envVars,
          },
          pulumiCommand: await createForceAbortableCommand(),
        },
      )

      signal?.throwIfAborted()

      try {
        return await runWithRetryOnError(
          () => fn(stack),
          error => this.tryUnlockStack(stack, error),
        )
      } catch (error) {
        if (error instanceof Error && error.message.includes("canceled")) {
          throw new AbortError("Stack cancelled", { cause: error })
        }

        throw error
      }
    })
  }

  async runLocal<T>(
    options: RunLocalOptions,
    fn: (stack: Stack) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const { projectId, pulumiProjectName, pulumiStackName, projectPath, stackConfig, envVars } =
      options

    return await this.lock.acquire(`${pulumiProjectName}.${pulumiStackName}`, async () => {
      const { LocalWorkspace } = await import("@pulumi/pulumi/automation/index.js")

      const stack = await LocalWorkspace.createOrSelectStack(
        {
          stackName: pulumiStackName,
          workDir: projectPath,
        },
        {
          projectSettings: {
            name: pulumiProjectName,
            runtime: {
              name: "nodejs",
              options: {
                nodeargs: "--no-deprecation",
              },
            },
            main: "index.js",
          },
          stackSettings: stackConfig
            ? {
                [pulumiStackName]: {
                  config: stackConfig,
                },
              }
            : undefined,
          envVars: {
            PULUMI_CONFIG_PASSPHRASE: await this.secretService.getPulumiPassword(projectId),
            PULUMI_K8S_AWAIT_ALL: "true",
            ...envVars,
          },
          pulumiCommand: await createForceAbortableCommand(),
        },
      )

      signal?.throwIfAborted()

      try {
        return await runWithRetryOnError(
          () => fn(stack),
          error => this.tryUnlockStack(stack, error),
        )
      } catch (error) {
        if (error instanceof Error && error.message.includes("canceled")) {
          throw new AbortError("Stack cancelled", { cause: error })
        }

        throw error
      }
    })
  }

  async tryUnlockStack(stack: Stack, error: unknown) {
    if (error instanceof Error && error.message.includes("the stack is currently locked")) {
      // TODO: kill the process if the hostname matches the current hostname

      this.logger.warn({ stackName: stack.name }, "unlocking stack")
      await stack.cancel()
      return true
    }

    return false
  }

  static create(secretService: SecretService, logger: Logger) {
    return new LocalPulumiHost(secretService, logger.child({ service: "LocalPulumiHost" }))
  }
}

export function updateResourceCount(opType: OpType, currentCount: number): number {
  switch (opType) {
    case "same":
    case "create":
    case "update":
    case "replace":
    case "create-replacement":
    case "import":
    case "import-replacement":
      return currentCount + 1

    case "delete":
    case "delete-replaced":
    case "discard":
    case "discard-replaced":
    case "remove-pending-replace":
      return currentCount - 1

    case "refresh":
    case "read-replacement":
    case "read":
      return currentCount

    default:
      throw new Error(`Unknown operation type: ${opType as string}`)
  }
}

export function calculateTotalResources(opMap: OpMap | undefined): number {
  if (!opMap) {
    return 0 // No operations imply no resources
  }

  let total = 0

  for (const [op, count] of Object.entries(opMap)) {
    const opType = op as OpType
    const value = count ?? 0
    total = updateResourceCount(opType, value)
  }

  return total
}

export async function pulumiErrorToString(error: unknown): Promise<string> {
  const { CommandError } = await import("@pulumi/pulumi/automation/index.js")

  if (error instanceof CommandError) {
    // biome-ignore lint/complexity/useLiteralKeys: не ори на отца
    const stderr = error["commandResult"].stderr as string
    let diagnosticsStart = stderr.indexOf("\u001b[38;5;13m\u001b[1mDiagnostics:")

    if (diagnosticsStart === -1) {
      diagnosticsStart = stderr.indexOf("Diagnostics:")
    }

    if (diagnosticsStart !== -1) {
      return stderr.slice(diagnosticsStart)
    }
  }

  return errorToString(error)
}
