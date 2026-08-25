import { describe, expect, test } from "vitest"
import { permissionDefinitionSchema } from "../permission"
import { backendPermissionGroups, backendRoleRuleSchema, backendRoleRulesSchema } from "./role"

describe("backendRoleRuleSchema", () => {
  test("requires at least one rule", () => {
    expect(backendRoleRulesSchema.safeParse([]).success).toBe(false)
  })

  test("defines valid metadata for every permission", () => {
    for (const group of backendPermissionGroups) {
      expect(permissionDefinitionSchema.array().safeParse(group.permissions).success).toBe(true)
    }
  })

  test("accepts escalation permissions with supported restrictions", () => {
    expect(
      backendRoleRuleSchema.safeParse({
        permissions: ["role.escalate"],
      }).success,
    ).toBe(true)

    expect(
      backendRoleRuleSchema.safeParse({
        permissions: ["backend-service-account-project-binding.bind"],
        restrictions: [{ type: "projects", projectIds: ["tz4a98xxat96iws9zmbrgj3a"] }],
      }).success,
    ).toBe(true)
  })

  test("defaults project space recursion to false", () => {
    const rule = backendRoleRuleSchema.parse({
      permissions: ["project.get"],
      restrictions: [{ type: "projects-in-spaces", projectSpaceIds: ["tz4a98xxat96iws9zmbrgj3a"] }],
    })

    expect(rule.restrictions).toEqual([
      {
        type: "projects-in-spaces",
        projectSpaceIds: ["tz4a98xxat96iws9zmbrgj3a"],
        recursive: false,
      },
    ])
  })

  test("accepts intersecting project restrictions", () => {
    expect(
      backendRoleRuleSchema.safeParse({
        permissions: ["project.open"],
        restrictions: [
          { type: "projects", projectIds: ["tz4a98xxat96iws9zmbrgj3a"] },
          {
            type: "projects-in-spaces",
            projectSpaceIds: ["pf2wxn3r4kwzazx7cm1t9mys"],
            recursive: true,
          },
        ],
      }).success,
    ).toBe(true)
  })

  test("rejects empty restrictions", () => {
    expect(
      backendRoleRuleSchema.safeParse({
        permissions: ["project.get"],
        restrictions: [],
      }).success,
    ).toBe(false)
  })

  test("rejects rules without permissions", () => {
    expect(backendRoleRuleSchema.safeParse({ permissions: [] }).success).toBe(false)
  })

  test("rejects incompatible permission restrictions", () => {
    expect(
      backendRoleRuleSchema.safeParse({
        permissions: ["backend.update"],
        restrictions: [{ type: "projects", projectIds: ["tz4a98xxat96iws9zmbrgj3a"] }],
      }).success,
    ).toBe(false)
  })

  test("rejects unknown permissions", () => {
    expect(
      backendRoleRuleSchema.safeParse({
        permissions: ["project.publish"],
      }).success,
    ).toBe(false)
  })

  test("accepts permissions from different groups in one unrestricted rule", () => {
    expect(
      backendRoleRuleSchema.safeParse({
        permissions: ["project.get", "project-space.get"],
      }).success,
    ).toBe(true)
  })

  test("accepts permissions from groups with compatible restrictions", () => {
    expect(
      backendRoleRuleSchema.safeParse({
        permissions: ["project.get", "backend-service-account-project-binding.get"],
        restrictions: [{ type: "projects", projectIds: ["tz4a98xxat96iws9zmbrgj3a"] }],
      }).success,
    ).toBe(true)
  })

  test("rejects permissions from groups with incompatible restrictions", () => {
    expect(
      backendRoleRuleSchema.safeParse({
        permissions: ["project.get", "project-space.get"],
        restrictions: [{ type: "projects", projectIds: ["tz4a98xxat96iws9zmbrgj3a"] }],
      }).success,
    ).toBe(false)
  })
})
