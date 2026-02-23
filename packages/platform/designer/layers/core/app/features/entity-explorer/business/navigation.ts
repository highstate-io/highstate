import type { Router } from "vue-router"

import { registerHighstateAction } from "#layers/core/app/utils/monaco"

let registered = false

export function ensureEntitySnapshotCodeLensNavigation(router: Router): void {
  if (registered) {
    return
  }

  registerHighstateAction("openEntitySnapshot", payload => {
    if (!payload || typeof payload !== "object") {
      return
    }

    const record = payload as Partial<{ projectId: string; snapshotId: string }>
    if (typeof record.projectId !== "string" || record.projectId.length === 0) {
      return
    }
    if (typeof record.snapshotId !== "string" || record.snapshotId.length === 0) {
      return
    }

    void router.push({
      name: "settings.entity-snapshot-details",
      params: {
        projectId: record.projectId,
        snapshotId: record.snapshotId,
      },
    })
  })

  registered = true
}
