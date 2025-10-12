import type {
  InstanceOperationStatus,
  InstanceEvaluationStatus,
  InstanceCustomStatus,
  InstanceEvaluationState,
  InstanceStatus,
  Operation,
} from "@highstate/backend"
import {
  isTransientInstanceOperationStatus,
  isTransientOperationStatus,
  type InstanceState,
  type ValidationOutput,
} from "@highstate/backend/shared"
import { WellKnownInstanceCustomStatus } from "@highstate/contract"

export type StatusPanelTab = {
  status: string
  message?: string
  logs?: boolean
  name: string
  title: string
  description?: string
  icon: string
  customIcon?: string
  color: string
  important: boolean
  order: number
  progress?: number
}

const wellKnownCustomStatusIcons: Record<WellKnownInstanceCustomStatus, string | undefined> = {
  error: "alert-circle-outline",
  healthy: "heart",
  degraded: "heart-flash",
  down: "heart-broken",
  warning: "alert-octagon-outline",
  progressing: "progress-clock",
}

const wellKnownStatusCustomColors: Record<WellKnownInstanceCustomStatus, string | undefined> = {
  error: "error",
  degraded: "warning",
  down: "error",
  healthy: "success",
  warning: "warning",
  progressing: "warning",
}

const operationStatusIcons: Record<InstanceOperationStatus, string> = {
  cancelled: "close-circle-outline",
  destroyed: "trash-can-outline",
  refreshed: "check-circle-outline",
  updated: "check-circle-outline",
  skipped: "skip-next-circle-outline",
  failed: "alert-circle-outline",
  cancelling: "stop-circle-outline",
  pending: "clock-outline",
  destroying: "trash-can-outline",
  processing_triggers: "flash",
  previewing: "eye-outline",
  previewed: "eye-outline",
  refreshing: "refresh",
  updating: "sync",
}

const operationStatusColors: Record<InstanceOperationStatus, string> = {
  updated: "success",
  cancelled: "warning",
  destroyed: "success",
  refreshed: "success",
  skipped: "",
  failed: "error",
  cancelling: "warning",
  pending: "",
  destroying: "error",
  processing_triggers: "primary",
  previewing: "secondary",
  previewed: "success",
  refreshing: "info",
  updating: "primary",
}

const instanceStatusIcons: Record<InstanceStatus, string> = {
  undeployed: "circle-outline",
  attempted: "clock-outline",
  deployed: "check-circle-outline",
  failed: "alert-circle-outline",
}

const instanceStatusColors: Record<InstanceStatus, string> = {
  undeployed: "",
  attempted: "warning",
  deployed: "success",
  failed: "error",
}

const evaluationStatusIcons: Record<InstanceEvaluationStatus, string> = {
  error: "alert-circle-outline",
  evaluated: "check-circle-outline",
  evaluating: "cogs",
}

const evaluationStatusColors: Record<InstanceEvaluationStatus, string> = {
  error: "error",
  evaluated: "success",
  evaluating: "primary",
}

function createInstanceStateTab(state: InstanceState, expectedInputHash?: number): StatusPanelTab {
  if (state.inputHash && state.inputHash !== expectedInputHash) {
    return {
      name: "instance-state",
      title: "State",
      status: "changed",
      message:
        "The configuration of this instance or one of its dependencies has changed since the last operation.",
      icon: "not-equal-variant",
      color: "warning",
      important: false,
      order: 5,
    }
  }

  return {
    name: "instance-state",
    status: state.status,
    title: "State",
    message: `Instance is ${state.status}`,
    icon: instanceStatusIcons[state.status],
    color: instanceStatusColors[state.status],
    order: 5,
    important: false,
  }
}

function createUndeployedTab(): StatusPanelTab {
  return {
    name: "instnace-state",
    status: "undeployed",
    title: "State",
    message: "Instance is not deployed",
    icon: "circle-outline",
    color: "",
    important: false,
    order: 5,
  }
}

function createOperationTab(state: InstanceState, operation?: Operation): StatusPanelTab {
  const operationState = state.lastOperationState!

  return {
    name: "operation",
    logs: true,
    title: "Operation",
    status: operationState.status,
    icon: operationStatusIcons[operationState.status],
    color: operationStatusColors[operationState.status],
    important:
      isTransientOperationStatus(operation?.status) ||
      (operationState.status === "failed" && state.status !== "undeployed"),
    order: 10,

    progress:
      isTransientInstanceOperationStatus(operationState.status) &&
      operationState.status !== "pending" &&
      operationState.currentResourceCount &&
      operationState.totalResourceCount
        ? Math.round(
            (operationState.currentResourceCount / operationState.totalResourceCount) * 100,
          )
        : undefined,
  }
}

function createEvaluationTab(state: InstanceEvaluationState): StatusPanelTab {
  return {
    name: "evaluation",
    status: state.status,
    title: "Evaluation",
    message: state.message ?? "",
    icon: evaluationStatusIcons[state.status],
    color: evaluationStatusColors[state.status],
    important: state.status === "error",
    order: 15,
  }
}

function createValidationOutputTab(validationOutput: ValidationOutput): StatusPanelTab {
  if (validationOutput.status === "ok") {
    return {
      name: "validation",
      status: "ok",
      title: "Validation",
      message: "Instance is valid",
      icon: "check-circle-outline",
      color: "success",
      important: false,
      order: 20,
    }
  }

  return {
    name: "validation",
    title: "Validation",
    status: "error",
    message: validationOutput.errorText,
    icon: "alert-circle-outline",
    color: "error",
    important: true,
    order: 20,
  }
}

function createCustomStatusTab(status: InstanceCustomStatus): StatusPanelTab {
  return {
    name: status.name,
    status: status.value,
    title: status.meta.title,
    message: status.message ?? "",

    icon:
      wellKnownCustomStatusIcons[status.value as WellKnownInstanceCustomStatus] ??
      "information-outline",

    customIcon: status.meta.icon,

    color:
      status.meta.iconColor ??
      wellKnownStatusCustomColors[status.value as WellKnownInstanceCustomStatus] ??
      "primary",

    important: status.value === WellKnownInstanceCustomStatus.Error,
    order: status.order ?? 50,
  }
}

export function createStatusPanelTabs(
  state: InstanceState | undefined,
  operation: Operation | undefined,
  expectedInputHash: number | undefined,
  validationOutput: ValidationOutput | undefined,
): StatusPanelTab[] {
  const tabs: StatusPanelTab[] = []

  // always show instance state tab
  if (state && state.status !== "undeployed") {
    tabs.push(createInstanceStateTab(state, expectedInputHash))
  } else {
    tabs.push(createUndeployedTab())
  }

  // show operation tab if there's a last operation
  if (state?.lastOperationState) {
    tabs.push(createOperationTab(state, operation))
  }

  if (state?.evaluationState) {
    tabs.push(createEvaluationTab(state.evaluationState))
  }

  if (validationOutput) {
    tabs.push(createValidationOutputTab(validationOutput))
  }

  if (state?.customStatuses) {
    for (const customStatus of state.customStatuses) {
      tabs.push(createCustomStatusTab(customStatus))
    }
  }

  return tabs.sort((a, b) => a.order - b.order)
}
