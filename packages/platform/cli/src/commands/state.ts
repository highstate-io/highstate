import { toJson } from "@bufbuild/protobuf"
import {
  GetInstanceStateResponseSchema,
  InstanceStateSchema,
  ListInstanceStatesResponseSchema,
} from "@highstate/api/v1"
import { Command, Option } from "clipanion"
import { messageJson } from "../shared/remote"
import { RemoteCommand } from "./remote"

export class StateListCommand extends RemoteCommand {
  static paths = [["state", "list"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Lists observed instance states.",
  })

  includeEvaluation = Option.Boolean("--include-evaluation", false)
  includeOperation = Option.Boolean("--include-operation", false)
  includeParent = Option.Boolean("--include-parent", false)
  includeExtra = Option.Boolean("--include-extra", false)
  includeCustomStatuses = Option.Boolean("--include-custom-statuses", false)
  pageSize = Option.String("--page-size")
  pageToken = Option.String("--page-token")
  all = Option.Boolean("--all", false)

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const states = []
    let pageToken = this.pageToken ?? ""

    do {
      const response = await clients.instanceState.listInstanceStates({
        projectId: target.projectId,
        includeEvaluationState: this.includeEvaluation,
        includeLastOperationState: this.includeOperation,
        includeParentInstanceId: this.includeParent,
        includeExtra: this.includeExtra,
        includeCustomStatuses: this.includeCustomStatuses,
        pageSize: Number(this.pageSize ?? 0),
        pageToken,
      })

      if (!this.all) {
        this.print(
          messageJson(ListInstanceStatesResponseSchema, response),
          response.states
            .map(value => `${value.id}\t${value.instanceId}\t${value.status}`)
            .join("\n") || "No instance states",
        )
        return
      }

      states.push(...response.states)
      pageToken = response.nextPageToken
    } while (pageToken)

    this.print(
      {
        states: states.map(value =>
          toJson(InstanceStateSchema, value, { useProtoFieldName: true }),
        ),
      },
      states.map(value => `${value.id}\t${value.instanceId}\t${value.status}`).join("\n") ||
        "No instance states",
    )
  }
}

export class StateGetCommand extends RemoteCommand {
  static paths = [["state", "get"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Gets one observed instance state.",
  })

  id = Option.String({ required: true })
  allProjections = Option.Boolean("--all-projections", false)

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const response = await clients.instanceState.getInstanceState({
      projectId: target.projectId,
      stateId: this.id,
      includeEvaluationState: this.allProjections,
      includeLastOperationState: this.allProjections,
      includeParentInstanceId: this.allProjections,
      includeExtra: this.allProjections,
      includeCustomStatuses: this.allProjections,
    })

    this.print(
      messageJson(GetInstanceStateResponseSchema, response),
      `${response.state?.instanceId}\t${response.state?.status}`,
    )
  }
}
