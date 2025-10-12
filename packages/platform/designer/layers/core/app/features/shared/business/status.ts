export type StatusChipMap = Record<
  string,
  { color: string; icon: string } | { color: string; loading: true }
>

export const terminalStatusMap: StatusChipMap = {
  active: { color: "success", icon: "mdi-play-circle" },
  unavailable: { color: "secondary", icon: "mdi-close-circle" },
}

export const operationStatusMap: StatusChipMap = {
  pending: { color: "warning", loading: true },
  running: { color: "info", loading: true },
  failing: { color: "error", icon: "mdi-alert-circle", loading: true },
  completed: { color: "success", icon: "mdi-check-circle" },
  failed: { color: "error", icon: "mdi-close-circle" },
  cancelled: { color: "secondary", icon: "mdi-cancel" },
}

export const workerStatusMap: StatusChipMap = {
  unknown: { color: "secondary", icon: "mdi-help-circle" },
  starting: { color: "warning", loading: true },
  running: { color: "success", icon: "mdi-check-circle" },
  stopping: { color: "warning", loading: true },
  stopped: { color: "secondary", icon: "mdi-stop" },
  error: { color: "error", icon: "mdi-alert-circle" },
}

export const workerVersionStatusMap: StatusChipMap = {
  unknown: { color: "secondary", icon: "mdi-help-circle" },
  starting: { color: "warning", loading: true },
  running: { color: "success", icon: "mdi-check-circle" },
  stopping: { color: "warning", loading: true },
  stopped: { color: "secondary", icon: "mdi-stop" },
  error: { color: "error", icon: "mdi-alert-circle" },
}

export const instanceOperationStatusMap: StatusChipMap = {
  updating: { color: "info", loading: true },
  processing_triggers: { color: "info", loading: true },
  previewing: { color: "info", loading: true },
  destroying: { color: "warning", loading: true },
  refreshing: { color: "info", loading: true },
  pending: { color: "warning", icon: "mdi-clock-outline" },
  cancelling: { color: "warning", loading: true },
  updated: { color: "success", icon: "mdi-check-circle" },
  skipped: { color: "secondary", icon: "mdi-skip-forward" },
  destroyed: { color: "secondary", icon: "mdi-delete-circle" },
  refreshed: { color: "success", icon: "mdi-check-circle" },
  cancelled: { color: "secondary", icon: "mdi-cancel" },
  failed: { color: "error", icon: "mdi-alert-circle" },
}

export const instanceStatusMap: StatusChipMap = {
  undeployed: { color: "secondary", icon: "mdi-circle-outline" },
  attempted: { color: "warning", icon: "mdi-clock-outline" },
  deployed: { color: "success", icon: "mdi-check-circle" },
  failed: { color: "error", icon: "mdi-alert-circle" },
}

export const instanceEvaluationStatusMap: StatusChipMap = {
  evaluating: { color: "info", loading: true },
  evaluated: { color: "success", icon: "mdi-check-circle" },
  error: { color: "error", icon: "mdi-alert-circle" },
}

export const operationTypeMap: StatusChipMap = {
  update: { color: "primary", icon: "mdi-arrow-up-circle" },
  preview: { color: "secondary", icon: "mdi-eye" },
  destroy: { color: "error", icon: "mdi-delete-circle" },
  recreate: { color: "warning", icon: "mdi-refresh-circle" },
  refresh: { color: "success", icon: "mdi-reload" },
}

export const unlockMethodTypeMap: StatusChipMap = {
  password: { color: "primary", icon: "mdi-key-variant" },
  passkey: { color: "success", icon: "mdi-fingerprint" },
}
