import type { BackendPermissionRestriction, ProjectPermissionRestriction } from "../shared"

export type PermissionRestriction = ProjectPermissionRestriction | BackendPermissionRestriction

export function permissionRestrictionsCover(
  grants: readonly PermissionRestriction[] | undefined,
  requested: readonly PermissionRestriction[] | undefined,
): boolean {
  if (!grants) {
    return true
  }

  if (!requested) {
    return false
  }

  return grants.every(grant => {
    const restriction = requested.find(item => item.type === grant.type)
    if (!restriction) {
      return false
    }

    if (grant.type === "self") {
      return true
    }

    if (restriction.type === "self") {
      return false
    }

    const grantIds = permissionRestrictionIds(grant)
    const requestedIds = permissionRestrictionIds(restriction)

    return (
      requestedIds.every(id => grantIds.includes(id)) &&
      (!("recursive" in restriction) ||
        !restriction.recursive ||
        ("recursive" in grant && grant.recursive))
    )
  })
}

function permissionRestrictionIds(
  restriction: Exclude<PermissionRestriction, { type: "self" }>,
): readonly string[] {
  switch (restriction.type) {
    case "resources":
      return restriction.resourceIds
    case "instances":
      return restriction.instanceIds
    case "owners":
      return restriction.serviceAccountIds
    case "workers":
      return restriction.workerIds
    case "projects":
      return restriction.projectIds
    case "project-spaces":
    case "projects-in-spaces":
      return restriction.projectSpaceIds
  }
}
