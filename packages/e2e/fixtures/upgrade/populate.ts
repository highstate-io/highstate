import { writeFile } from "node:fs/promises"
import { join } from "node:path"

// Import the installed published release, never this checkout's workspace backend.
const { createServices, loadConfig } = await import(process.env.HIGHSTATE_E2E_PREVIOUS_BACKEND!)
const { backendPermissionGroups, projectPermissionGroups } = await import(
  process.env.HIGHSTATE_E2E_PREVIOUS_SHARED!
)
const services = await createServices({ config: await loadConfig(process.env, false) })
const permissions = (groups: { permissions: { name: string }[] }[]) => new Map(
  groups.flatMap(group => group.permissions.map(permission => [permission.name, [{ restrictions: [] }]])),
)
const context = {
  realm: "backend",
  subject: { type: "user", userId: "upgrade-fixture", groupIds: [] },
  permissions: permissions(backendPermissionGroups),
}
const credential = await services.backendApiKeySettingsService.create(context, {
  meta: { title: "Preserved release credential" }, restrictionRules: [], expiresAt: null,
})
const project = await services.projectService.createProject(context, {
  name: "previous-release-project", meta: { title: "Populated before upgrade" },
  spaceId: "q8xbilhwpsn65zjlv5kz44qh",
  modelStorageId: "rmi0hmo1tjjsyfry9l178fus",
  libraryId: "n0rfvpl9o77iqf29ff4kk5gf",
  pulumiBackendId: "pmn9y901jeiz2ydh93045l39",
}, { type: "password", meta: { title: "Upgrade fixture" }, recipient: "unused-unencrypted", encryptedIdentity: "unused-unencrypted" })
const projectContext = {
  realm: "project", projectId: project.id,
  subject: { type: "service-account", serviceAccountId: "upgrade-fixture" },
  permissions: permissions(projectPermissionGroups),
}
const instance = { id: "e2e.marker.v1:legacy", type: "e2e.marker.v1", name: "legacy", kind: "unit", args: { value: "preserved" }, inputs: {}, outputs: {} }
await services.projectService.createNodes(projectContext, [instance], [])
const database = await services.database.forProject(project.id)
const state = await database.instanceState.findUniqueOrThrow({ where: { instanceId: instance.id } })
await services.secretService.getPulumiPassword(project.id)
await writeFile(join(process.env.HIGHSTATE_CODEBASE_PATH!, "credential"), credential.token, { mode: 0o600 })
await writeFile(join(process.env.HIGHSTATE_CODEBASE_PATH!, "previous.json"), JSON.stringify({ projectId: project.id, instanceId: instance.id, stateId: state.id, databaseVersion: project.databaseVersion }))
process.exit(0)
