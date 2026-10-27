import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { operationPhaseSchema, operationPlanInputSchema, stableJsonStringify } from "../shared"

export const reviewedPlanSchema = operationPlanInputSchema.extend({
  phases: operationPhaseSchema.array(),
  librarySnapshotId: z.string().nullable(),
  modelRevision: z.string(),
  localOverlayRevision: z.string().nullable(),
  expiresAt: z.number(),
})
export type ReviewedPlan = z.infer<typeof reviewedPlanSchema>

/** A backend restart intentionally invalidates outstanding reviews unless a durable key is supplied. */
export class ReviewedPlanSigner {
  constructor(private readonly key: Uint8Array = randomBytes(32)) {}

  sign(plan: ReviewedPlan): string {
    const payload = Buffer.from(stableJsonStringify(reviewedPlanSchema.parse(plan))).toString(
      "base64url",
    )
    return `${payload}.${this.mac(payload).toString("base64url")}`
  }

  verify(token: string): ReviewedPlan {
    const [payload, signature, extra] = token.split(".")
    if (!payload || !signature || extra) throw new Error("Invalid reviewed plan token")
    const actual = Buffer.from(signature, "base64url")
    const expected = this.mac(payload)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error("Invalid reviewed plan signature")
    const plan = reviewedPlanSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString()))
    if (plan.expiresAt <= Date.now()) throw new Error("Reviewed plan expired")
    return plan
  }

  private mac(payload: string): Buffer {
    return createHmac("sha256", this.key).update(payload).digest()
  }
}
