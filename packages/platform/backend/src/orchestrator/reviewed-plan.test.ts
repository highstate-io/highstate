import { describe, expect, test } from "vitest"
import { type ReviewedPlan, ReviewedPlanSigner, reviewedPlanSchema } from "./reviewed-plan"

const review = (): ReviewedPlan => ({
  projectId: "project",
  type: "destroy",
  instanceIds: ["test.unit.v1:unit"],
  options: { refresh: true },
  phases: [{ type: "destroy", instances: [{ id: "test.unit.v1:unit", message: "requested" }] }],
  librarySnapshotId: "snapshot",
  modelRevision: "model",
  localOverlayRevision: "overlay",
  expiresAt: Date.now() + 60_000,
})

describe("ReviewedPlanSigner", () => {
  test("binds every review field and rejects modified payloads", () => {
    const signer = new ReviewedPlanSigner()
    const plan = review()
    const token = signer.sign(plan)
    expect(signer.verify(token)).toEqual(reviewedPlanSchema.parse(plan))
    const [payload, signature] = token.split(".")
    const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString())

    for (const [field, value] of Object.entries({
      projectId: "different-project",
      type: "update",
      options: {},
      instanceIds: ["test.unit.v1:other"],
      phases: [],
      librarySnapshotId: "other-snapshot",
      modelRevision: "other-model",
      localOverlayRevision: "other-overlay",
    })) {
      const tampered = Buffer.from(JSON.stringify({ ...decoded, [field]: value })).toString(
        "base64url",
      )

      expect(() => signer.verify(`${tampered}.${signature}`)).toThrow("signature")
    }
  })

  test("rejects expired tokens and reviews signed by a replaced backend key", () => {
    const signer = new ReviewedPlanSigner()

    expect(() => signer.verify(signer.sign({ ...review(), expiresAt: Date.now() - 1 }))).toThrow(
      "expired",
    )

    expect(() => new ReviewedPlanSigner().verify(signer.sign(review()))).toThrow("signature")
  })
})
