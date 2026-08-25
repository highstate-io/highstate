import type { PermissionDefinition, PermissionRiskGrant } from "./permission"
import { describe, expect, test } from "vitest"
import { assessPermissionRisk, permissionDefinitionSchema } from "./permission"

const lowPermission = permission("read", "Read data", "low")
const mediumPermission = permission("inspect", "Inspect logs", "medium")
const highPermission = permission("manage", "Manage data", "high")
const criticalPermission: PermissionDefinition = {
  name: "impersonate",
  title: "Impersonate users",
  risk: "critical",
  consequence: "Allows acting with another user's authority.",
}

describe("assessPermissionRisk", () => {
  test("returns no risk without permissions", () => {
    expect(assessPermissionRisk([])).toEqual({
      risk: null,
      message: "Select permissions to calculate the role risk.",
    })
  })

  test("keeps low permissions at low risk", () => {
    expect(assessPermissionRisk([grant(lowPermission)])).toEqual({
      risk: "low",
      message: "The selected permissions are low risk. No additional mitigation is required.",
    })
  })

  test("reports medium permissions with relevant mitigation", () => {
    const assessment = assessPermissionRisk([grant(mediumPermission)])

    expect(assessment.risk).toBe("medium")
    expect(assessment.message).toContain("Inspect logs")
    expect(assessment.message).toContain("Prefer low-risk permissions")
    expect(assessment.message).not.toContain("high to medium")
  })

  test("keeps unrestricted high permissions at high risk", () => {
    const assessment = assessPermissionRisk([grant(highPermission)])

    expect(assessment.risk).toBe("high")
    expect(assessment.message).toContain("Manage data")
    expect(assessment.message).toContain("Add restrictions")
    expect(assessment.message).not.toContain("critical")
  })

  test("reduces fully restricted high permissions to medium", () => {
    const assessment = assessPermissionRisk([grant(highPermission, true)])

    expect(assessment.risk).toBe("medium")
    expect(assessment.message).toContain("high to medium")
    expect(assessment.message).toContain("narrow as possible")
    expect(assessment.message).not.toContain("Add restrictions")
  })

  test("uses the least restricted duplicate grant", () => {
    const assessment = assessPermissionRisk([
      grant(highPermission, true),
      grant(highPermission, false),
    ])

    expect(assessment.risk).toBe("high")
  })

  test("reports every selected critical consequence", () => {
    const secondCriticalPermission: PermissionDefinition = {
      name: "escalate",
      title: "Escalate permissions",
      risk: "critical",
      consequence: "Allows granting access beyond the caller's authority.",
    }
    const assessment = assessPermissionRisk([
      grant(criticalPermission, true),
      grant(secondCriticalPermission),
      grant(highPermission),
    ])

    expect(assessment.risk).toBe("critical")
    expect(assessment.message).toContain(
      `"${criticalPermission.title}" is critical: allows acting with another user's authority.`,
    )
    expect(assessment.message).toContain(
      `"${secondCriticalPermission.title}" is critical: allows granting access beyond the caller's authority.`,
    )
    expect(assessment.message).toContain("Remove all critical permissions")
    expect(assessment.message).not.toContain("Add restrictions")
  })
})

describe("permissionDefinitionSchema", () => {
  test("requires consequences for critical permissions", () => {
    expect(
      permissionDefinitionSchema.safeParse({
        name: "critical",
        title: "Critical permission",
        risk: "critical",
      }).success,
    ).toBe(false)
  })
})

function permission(
  name: string,
  title: string,
  risk: "low" | "medium" | "high",
): PermissionDefinition {
  return { name, title, risk }
}

function grant(permission: PermissionDefinition, restricted = false): PermissionRiskGrant {
  return { permission, restricted }
}
