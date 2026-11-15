import type { AccessRequirement } from "./access-control"

const settingsPermissions: Record<string, AccessRequirement["permission"]> = {
  "backend-users": "user.list",
  "backend-user-details": "user.get",
  users: "user.list",
  "user-details": "user.get",
  "project-list": "project.list",
  "backend-service-accounts": "service-account.list",
  "backend-api-keys": "api-key.list",
  "backend-roles": "role.list",
  "service-accounts": "service-account.list",
  "api-keys": "api-key.list",
  "project-roles": "role.list",
  operations: "operation.list",
  terminals: "terminal.list",
  pages: "page.list",
  panels: "panel.list",
  secrets: "secret.list",
  triggers: "trigger.list",
  artifacts: "artifact.list",
  workers: "worker.list",
  entities: "entity.list",
  instances: "instance-state.list",
  "unlock-methods": "unlock-method.list",
  "backend-service-account-details": "service-account.get",
  "backend-api-key-details": "api-key.get",
  "backend-role-details": "role.get",
  "service-account-details": "service-account.get",
  "api-key-details": "api-key.get",
  "project-role-details": "role.get",
  "operation-details": "operation.get",
  "terminal-details": "terminal.get",
  "page-details": "page.get",
  "panel-details": "panel.get",
  "secret-details": "secret.metadata.get",
  "trigger-details": "trigger.get",
  "artifact-details": "artifact.get",
  "worker-details": "worker.get",
  "worker-version-details": "worker-version.get",
  "entity-details": "entity.get",
  "entity-snapshot-details": "entity-snapshot.get",
  "instance-details": "instance-state.get",
  "unlock-method-details": "unlock-method.get",
}

/**
 * Route hints do not replace the resource-scoped checks made by the requested service.
 */
export function routeAccess(
  name: string,
  params: Record<string, unknown> = {},
): AccessRequirement[] {
  const projectId = typeof params.projectId === "string" ? params.projectId : undefined
  const permission = settingsPermissions[name.replace(/^settings\./, "")]
  if (name.startsWith("settings.") && permission) {
    return [
      {
        permission,
        projectId:
          name.includes("backend-") || name === "settings.project-list" ? undefined : projectId,
        collection: true,
      },
    ]
  }

  if (name === "project" || name === "composite-instance") {
    return [{ permission: "project.get", target: { projectId } }]
  }

  switch (name) {
    case "instance-logs":
      return [{ permission: "operation.logs.get", projectId, collection: true }]
    case "worker-version-logs":
      return [{ permission: "worker-version.get", projectId, collection: true }]
    case "terminal-session":
      return [{ permission: "terminal.connect", projectId, collection: true }]
    case "unit-page":
      return [{ permission: "page.get", projectId, collection: true }]
    case "unit-panel":
      return [{ permission: "panel.get", projectId, collection: true }]
  }

  return []
}
