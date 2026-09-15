import { toJson } from "@bufbuild/protobuf"
import {
  GetOperationResponseSchema,
  ListOperationsResponseSchema,
  OperationSchema,
  OperationStatus,
} from "@highstate/api/v1"
import { confirm } from "@inquirer/prompts"
import { Command, Option } from "clipanion"
import {
  operationOptions,
  operationOptionsInputSchema,
  operationType,
  operationTypeSchema,
  type PlanDocument,
  phasesFromPlan,
  phasesToJson,
  planDocumentSchema,
  readDocument,
  timestampFromUlid,
} from "../shared"
import { RemoteCommand } from "./remote"

abstract class OperationRequestCommand extends RemoteCommand {
  forceUpdateDependencies = Option.Boolean("--force-update-dependencies", false)
  ignoreChangedDependencies = Option.Boolean("--ignore-changed-dependencies", false)
  ignoreDependencies = Option.Boolean("--ignore-dependencies", false)
  forceUpdateChildren = Option.Boolean("--force-update-children", false)
  onlyDestroyGhosts = Option.Boolean("--only-destroy-ghosts", false)
  firstDestroyGhosts = Option.Boolean("--first-destroy-ghosts", false)
  ignoreGhosts = Option.Boolean("--ignore-ghosts", false)
  destroyDependentInstances = Option.Boolean("--destroy-dependent-instances", false)
  invokeDestroyTriggers = Option.Boolean("--invoke-destroy-triggers", false)
  deleteUnreachableResources = Option.Boolean("--delete-unreachable-resources", false)
  forceDeleteState = Option.Boolean("--force-delete-state", false)
  allowPartialCompositeInstanceUpdate = Option.Boolean(
    "--allow-partial-composite-instance-update",
    false,
  )
  allowPartialCompositeInstanceDestruction = Option.Boolean(
    "--allow-partial-composite-instance-destruction",
    false,
  )
  refresh = Option.Boolean("--refresh", false)
  debug = Option.Boolean("--debug", false)

  optionsInput() {
    return operationOptionsInputSchema.parse({
      force_update_dependencies: this.forceUpdateDependencies,
      ignore_changed_dependencies: this.ignoreChangedDependencies,
      ignore_dependencies: this.ignoreDependencies,
      force_update_children: this.forceUpdateChildren,
      only_destroy_ghosts: this.onlyDestroyGhosts,
      first_destroy_ghosts: this.firstDestroyGhosts,
      ignore_ghosts: this.ignoreGhosts,
      destroy_dependent_instances: this.destroyDependentInstances,
      invoke_destroy_triggers: this.invokeDestroyTriggers,
      delete_unreachable_resources: this.deleteUnreachableResources,
      force_delete_state: this.forceDeleteState,
      allow_partial_composite_instance_update: this.allowPartialCompositeInstanceUpdate,
      allow_partial_composite_instance_destruction: this.allowPartialCompositeInstanceDestruction,
      refresh: this.refresh,
      debug: this.debug,
    })
  }
}

async function createPlan(
  command: OperationRequestCommand,
  typeValue: string,
  instanceIds: string[],
) {
  const type = operationTypeSchema.parse(typeValue)
  if (!instanceIds.length) {
    throw new Error("At least one instance ID is required")
  }

  const { clients, target } = await command.remote()
  const options = command.optionsInput()
  const response = await clients.operation.planOperation({
    projectId: target.projectId,
    type: operationType(type),
    instanceIds,
    options: operationOptions(options),
  })

  const document: PlanDocument = {
    format_version: 1,
    project_id: target.projectId,
    type,
    instance_ids: instanceIds,
    options,
    phases: phasesToJson(response.phases),
  }

  return { clients, target, document, phases: response.phases }
}

function humanPlan(document: PlanDocument): string {
  return (
    document.phases
      .flatMap(phase => {
        const value = phase as {
          type?: string
          instances?: Array<{ id?: string; message?: string }>
        }

        return [
          String(value.type ?? "phase"),
          ...(value.instances ?? []).map(instance => `  ${instance.id}: ${instance.message}`),
        ]
      })
      .join("\n") || "No operation phases"
  )
}

export class OperationPlanCommand extends OperationRequestCommand {
  static paths = [["operation", "plan"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Plans an infrastructure operation without launching it.",
  })

  type = Option.String({ required: true })
  instanceIds = Option.Rest({ required: 1 })

  async execute(): Promise<void> {
    const { document } = await createPlan(this, this.type, this.instanceIds)
    this.print(document, humanPlan(document))
  }
}

async function launchPlan(
  command: RemoteCommand,
  document: PlanDocument,
  title: string,
  description?: string,
) {
  const { clients, target } = await command.remote(false)
  if (target.projectId && target.projectId !== document.project_id) {
    throw new Error(
      `Plan project "${document.project_id}" does not match selected project "${target.projectId}"`,
    )
  }

  return await clients.operation.launchOperation({
    projectId: document.project_id,
    type: operationType(document.type),
    instanceIds: document.instance_ids,
    options: operationOptions(document.options),
    meta: { title, description },
    plan: phasesFromPlan(document),
  })
}

export class OperationLaunchCommand extends RemoteCommand {
  static paths = [["operation", "launch"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Launches an operation from a reviewed plan document.",
  })

  plan = Option.String("--plan", { required: true })
  title = Option.String("--title", { required: true })
  description = Option.String("--description")

  async execute(): Promise<void> {
    const document = planDocumentSchema.parse(await readDocument(this.plan))
    const response = await launchPlan(this, document, this.title, this.description)

    this.print(
      {
        operation: response.operation
          ? toJson(OperationSchema, response.operation, { useProtoFieldName: true })
          : undefined,
      },
      `Launched operation "${response.operation?.id}"`,
    )
  }
}

export class OperationRunCommand extends OperationRequestCommand {
  static paths = [["operation", "run"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Plans, confirms, and launches an infrastructure operation.",
  })

  type = Option.String({ required: true })
  instanceIds = Option.Rest({ required: 1 })
  title = Option.String("--title")
  description = Option.String("--description")
  yes = Option.Boolean("--yes", false)

  async execute(): Promise<void> {
    const { document } = await createPlan(this, this.type, this.instanceIds)
    if (!this.yes) {
      if (!process.stdin.isTTY) {
        throw new Error("Noninteractive operation execution requires --yes")
      }

      process.stderr.write(`${humanPlan(document)}\n`)
      if (!(await confirm({ message: "Launch this operation?", default: false }))) {
        return
      }
    }

    const response = await launchPlan(
      this,
      document,
      this.title ?? `${document.type} ${document.instance_ids.join(", ")}`,
      this.description,
    )

    this.print(
      {
        operation: response.operation
          ? toJson(OperationSchema, response.operation, { useProtoFieldName: true })
          : undefined,
      },
      `Launched operation "${response.operation?.id}"`,
    )
  }
}

export class OperationListCommand extends RemoteCommand {
  static paths = [["operation", "list"]]

  static usage = Command.Usage({ category: "Backend API", description: "Lists recent operations." })

  pageSize = Option.String("--page-size")
  pageToken = Option.String("--page-token")
  all = Option.Boolean("--all", false)

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const operations = []
    let pageToken = this.pageToken ?? ""
    do {
      const response = await clients.operation.listOperations({
        projectId: target.projectId,
        pageSize: Number(this.pageSize ?? 0),
        pageToken,
      })
      if (!this.all) {
        this.print(
          toJson(ListOperationsResponseSchema, response, { useProtoFieldName: true }),
          response.operations
            .map(value => `${value.id}\t${value.type}\t${value.status}\t${value.meta?.title}`)
            .join("\n") || "No operations",
        )
        return
      }

      operations.push(...response.operations)
      pageToken = response.nextPageToken
    } while (pageToken)

    this.print(
      {
        operations: operations.map(value =>
          toJson(OperationSchema, value, { useProtoFieldName: true }),
        ),
      },
      operations
        .map(value => `${value.id}\t${value.type}\t${value.status}\t${value.meta?.title}`)
        .join("\n") || "No operations",
    )
  }
}

export class OperationGetCommand extends RemoteCommand {
  static paths = [["operation", "get"]]

  static usage = Command.Usage({ category: "Backend API", description: "Gets an operation." })

  id = Option.String({ required: true })

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const response = await clients.operation.getOperation({
      projectId: target.projectId,
      operationId: this.id,
    })
    this.print(
      toJson(GetOperationResponseSchema, response, { useProtoFieldName: true }),
      `${response.operation?.id}\t${response.operation?.status}\t${response.operation?.meta?.title}`,
    )
  }
}

const finalStatuses = new Set([
  OperationStatus.COMPLETED,
  OperationStatus.FAILED,
  OperationStatus.CANCELLED,
])

export class OperationWaitCommand extends RemoteCommand {
  static paths = [["operation", "wait"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Waits for an operation to finish.",
  })

  id = Option.String({ required: true })
  timeout = Option.String("--timeout", "0")

  async execute(): Promise<number | undefined> {
    const { clients, target } = await this.remote()
    const timeout = Number(this.timeout)
    const deadline = timeout > 0 ? Date.now() + timeout * 1000 : undefined
    while (true) {
      const response = await clients.operation.getOperation({
        projectId: target.projectId,
        operationId: this.id,
      })
      if (response.operation && finalStatuses.has(response.operation.status)) {
        this.print(
          toJson(GetOperationResponseSchema, response, { useProtoFieldName: true }),
          `${response.operation.id}\t${response.operation.status}`,
        )
        return response.operation.status === OperationStatus.COMPLETED ? 0 : 1
      }

      if (deadline && Date.now() >= deadline) {
        throw new Error(`Timed out waiting for operation "${this.id}"`)
      }

      await Bun.sleep(1000)
    }
  }
}

export class OperationLogsCommand extends RemoteCommand {
  static paths = [["operation", "logs"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Gets chronological operation logs.",
  })

  id = Option.String({ required: true })
  stateId = Option.String("--state")
  follow = Option.Boolean("--follow", false)

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const values: Array<{
      timestamp: string
      id: string
      operation_id: string
      state_id?: string
      is_system: boolean
      content: string
    }> = []
    const seen = new Set<string>()
    while (true) {
      let pageToken = ""
      const added = []
      do {
        const response = await clients.operation.listOperationLogs({
          projectId: target.projectId,
          operationId: this.id,
          stateId: this.stateId,
          pageSize: 100,
          pageToken,
        })
        for (const value of response.logs) {
          if (seen.has(value.id)) {
            continue
          }

          seen.add(value.id)
          added.push({
            timestamp: timestampFromUlid(value.id),
            id: value.id,
            operation_id: value.operationId,
            state_id: value.stateId,
            is_system: value.isSystem,
            content: value.content,
          })
        }
        pageToken = response.nextPageToken
      } while (pageToken)

      values.push(...added)
      if (this.follow && this.format() === "human" && added.length) {
        process.stdout.write(`${humanLogs(added)}\n`)
      }

      if (!this.follow) {
        break
      }

      const operation = await clients.operation.getOperation({
        projectId: target.projectId,
        operationId: this.id,
      })
      if (operation.operation && finalStatuses.has(operation.operation.status)) {
        break
      }

      await Bun.sleep(1000)
    }

    if (this.follow && this.format() === "human") {
      return
    }

    this.print({ logs: values }, humanLogs(values) || "No logs")
  }
}

function humanLogs(
  values: Array<{
    timestamp: string
    state_id?: string
    is_system: boolean
    content: string
  }>,
): string {
  return values
    .map(
      value =>
        `[${value.timestamp}]${value.is_system ? " [system]" : ""}${value.state_id ? ` [state ${value.state_id}]` : ""} ${value.content.replaceAll(/\r?\n/g, "\\n")}`,
    )
    .join("\n")
}

abstract class CancelCommand extends RemoteCommand {
  yes = Option.Boolean("--yes", false)

  protected requireConfirmation(): void {
    if (!this.yes) {
      throw new Error("Operation cancellation requires --yes")
    }
  }
}

export class OperationCancelCommand extends CancelCommand {
  static paths = [["operation", "cancel"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Requests operation cancellation.",
  })

  id = Option.String({ required: true })

  async execute(): Promise<void> {
    this.requireConfirmation()

    const { clients, target } = await this.remote()

    await clients.operation.cancelOperation({ projectId: target.projectId, operationId: this.id })

    this.print({}, `Requested cancellation of operation "${this.id}"`)
  }
}

export class OperationCancelInstanceCommand extends CancelCommand {
  static paths = [["operation", "cancel-instance"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Requests cancellation of one instance in an operation.",
  })

  operationId = Option.String({ required: true })
  instanceId = Option.String({ required: true })

  async execute(): Promise<void> {
    this.requireConfirmation()

    const { clients, target } = await this.remote()

    await clients.operation.cancelInstanceOperation({
      projectId: target.projectId,
      operationId: this.operationId,
      instanceId: this.instanceId,
    })

    this.print({}, `Requested cancellation of instance "${this.instanceId}"`)
  }
}
