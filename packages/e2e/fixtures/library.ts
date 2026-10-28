import { defineComponent, defineEntity, defineUnit, z } from "@highstate/contract"

export const markerEntity = defineEntity({
  type: "e2e.marker.v1",
  schema: z.object({ marker: z.string(), value: z.string() }),
})

export const marker = defineUnit({
  type: "e2e.marker.v1",
  args: {
    endpoint: z.string().url(),
    key: z.string().min(1),
    value: z.string(),
  },
  outputs: { marker: markerEntity },
  source: { package: "@highstate/e2e-resources", path: "marker" },
})

export const composite = defineComponent({
  type: "e2e.composite.v1",
  args: {
    endpoint: z.string().url(),
    key: z.string().min(1),
    value: z.string(),
  },
  outputs: { marker: markerEntity },
  create({ name, args }) {
    return marker({ name: `${name}-child`, args })
  },
})
