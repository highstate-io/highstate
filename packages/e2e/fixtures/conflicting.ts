import { defineUnit, z } from "@highstate/contract"

// deliberately incompatible with the same type exported by e2e-library
export const marker = defineUnit({
  type: "e2e.marker.v1",
  args: { conflicting: z.number() },
  source: { package: "@highstate/e2e-conflicting", path: "marker" },
})
