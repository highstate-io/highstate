import { describe, expect, test } from "vitest"
import { permissionDefinitionSchema } from "../permission"
import { projectPermissionGroups, projectRoleRuleSchema, projectRoleRulesSchema } from "./role"

describe("projectRoleRuleSchema", () => {
  test("requires at least one rule", () => {
    expect(projectRoleRulesSchema.safeParse([]).success).toBe(false)
  })

  test("defines valid metadata for every permission", () => {
    for (const group of projectPermissionGroups) {
      expect(permissionDefinitionSchema.array().safeParse(group.permissions).success).toBe(true)
    }
  })

  test("accepts escalation permissions with supported restrictions", () => {
    expect(
      projectRoleRuleSchema.safeParse({
        permissions: ["role.escalate"],
      }).success,
    ).toBe(true)

    expect(
      projectRoleRuleSchema.safeParse({
        permissions: ["service-account.impersonate"],
        restrictions: [{ type: "resources", resourceIds: ["service-account-id"] }],
      }).success,
    ).toBe(true)
  })

  test("defaults instance recursion to false", () => {
    const rule = projectRoleRuleSchema.parse({
      permissions: ["instance-model.update"],
      restrictions: [{ type: "instances", instanceIds: ["component.v1:database"] }],
    })

    expect(rule.restrictions).toEqual([
      {
        type: "instances",
        instanceIds: ["component.v1:database"],
        recursive: false,
      },
    ])
  })

  test("accepts multiple compatible restriction types", () => {
    expect(
      projectRoleRuleSchema.safeParse({
        permissions: ["secret.value.get"],
        restrictions: [
          { type: "instances", instanceIds: ["component.v1:database"], recursive: true },
          { type: "self" },
        ],
      }).success,
    ).toBe(true)
  })

  test("rejects empty restrictions", () => {
    expect(
      projectRoleRuleSchema.safeParse({
        permissions: ["instance-model.get"],
        restrictions: [],
      }).success,
    ).toBe(false)
  })

  test("rejects rules without permissions", () => {
    expect(projectRoleRuleSchema.safeParse({ permissions: [] }).success).toBe(false)
  })

  test("rejects duplicate restriction types", () => {
    expect(
      projectRoleRuleSchema.safeParse({
        permissions: ["secret.value.get"],
        restrictions: [{ type: "self" }, { type: "self" }],
      }).success,
    ).toBe(false)
  })

  test("rejects incompatible permission restrictions", () => {
    expect(
      projectRoleRuleSchema.safeParse({
        permissions: ["instance-model.update"],
        restrictions: [{ type: "self" }],
      }).success,
    ).toBe(false)
  })

  test("rejects unknown permissions", () => {
    expect(
      projectRoleRuleSchema.safeParse({
        permissions: ["instance-model.publish"],
      }).success,
    ).toBe(false)
  })

  test("accepts compatible permissions from different groups in one rule", () => {
    expect(
      projectRoleRuleSchema.safeParse({
        permissions: ["secret.metadata.get", "artifact.get"],
        restrictions: [{ type: "instances", instanceIds: ["component.v1:database"] }],
      }).success,
    ).toBe(true)
  })

  test("rejects incompatible permissions from different groups in one rule", () => {
    expect(
      projectRoleRuleSchema.safeParse({
        permissions: ["instance-model.get", "secret.metadata.get"],
        restrictions: [{ type: "self" }],
      }).success,
    ).toBe(false)
  })
})
