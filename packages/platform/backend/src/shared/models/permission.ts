import { z } from "@highstate/contract"

export const permissionRiskSchema = z.enum(["low", "medium", "high", "critical"])

export type PermissionRisk = z.infer<typeof permissionRiskSchema>

const permissionDefinitionBaseSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
})

export const permissionDefinitionSchema = z.discriminatedUnion("risk", [
  permissionDefinitionBaseSchema.extend({ risk: z.enum(["low", "medium", "high"]) }),
  permissionDefinitionBaseSchema.extend({
    risk: z.literal("critical"),
    consequence: z.string().trim().min(1),
  }),
])

export type PermissionDefinition = z.infer<typeof permissionDefinitionSchema>

export type PermissionRiskGrant = {
  permission: PermissionDefinition
  restricted: boolean
}

export type PermissionRiskAssessment = {
  risk: PermissionRisk | null
  message: string
}

/**
 * Assesses the effective risk of permission grants and describes relevant mitigations.
 *
 * A high-risk permission is reduced to medium only when every grant of that permission is restricted.
 * Critical permissions are never reduced by restrictions.
 *
 * @param grants The permission grants to assess.
 * @returns The effective risk and its mitigation message.
 */
export function assessPermissionRisk(grants: PermissionRiskGrant[]): PermissionRiskAssessment {
  const grantsByPermission = new Map<
    string,
    { permission: PermissionDefinition; restricted: boolean }
  >()

  for (const grant of grants) {
    const existing = grantsByPermission.get(grant.permission.name)
    grantsByPermission.set(grant.permission.name, {
      permission: grant.permission,
      restricted: (existing?.restricted ?? true) && grant.restricted,
    })
  }

  const effectiveGrants = [...grantsByPermission.values()]
  if (effectiveGrants.length === 0) {
    return { risk: null, message: "Select permissions to calculate the role risk." }
  }

  const criticalPermissions = effectiveGrants
    .map(grant => grant.permission)
    .filter(permission => permission.risk === "critical")
  if (criticalPermissions.length > 0) {
    const consequences = criticalPermissions
      .map(
        permission =>
          `"${permission.title}" is critical: ${lowercaseFirst(permission.consequence)}`,
      )
      .join(" ")
    return {
      risk: "critical",
      message: `${consequences} Remove all critical permissions to lower the risk verdict.`,
    }
  }

  const unrestrictedHighPermissions = effectiveGrants
    .filter(grant => grant.permission.risk === "high" && !grant.restricted)
    .map(grant => grant.permission.title)
  if (unrestrictedHighPermissions.length > 0) {
    return {
      risk: "high",
      message: `Add restrictions to every rule granting ${formatList(unrestrictedHighPermissions)}. Restricting all high-risk permissions lowers the verdict to medium.`,
    }
  }

  const restrictedHighPermissions = effectiveGrants
    .filter(grant => grant.permission.risk === "high")
    .map(grant => grant.permission.title)
  const mediumPermissions = effectiveGrants
    .filter(grant => grant.permission.risk === "medium")
    .map(grant => grant.permission.title)
  if (restrictedHighPermissions.length > 0 || mediumPermissions.length > 0) {
    const sentences: string[] = []
    if (restrictedHighPermissions.length > 0) {
      sentences.push(
        `Restrictions reduce ${formatList(restrictedHighPermissions)} from high to medium risk.`,
        "Keep every restriction as narrow as possible.",
      )
    }
    if (mediumPermissions.length > 0) {
      sentences.push(
        `Review whether ${formatList(mediumPermissions)} are required and restrict them where supported.`,
        "Prefer low-risk permissions when they can meet the same need.",
      )
    }

    return { risk: "medium", message: sentences.join(" ") }
  }

  return {
    risk: "low",
    message: "The selected permissions are low risk. No additional mitigation is required.",
  }
}

function formatList(values: string[]): string {
  const quoted = values.map(value => `"${value}"`)
  if (quoted.length <= 1) {
    return quoted[0] ?? ""
  }

  return `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`
}

function lowercaseFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1)
}
