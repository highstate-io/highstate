import { defineComponent, defineEntity, defineUnit, fileSchema, z } from "@highstate/contract"

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

export const fileEntity = defineEntity({ type: "e2e.file.v1", schema: fileSchema })

export const services = defineUnit({
  type: "e2e.services.v1",
  args: { endpoint: z.url(), workerImage: z.string() },
  outputs: { file: fileEntity },
  source: { package: "@highstate/e2e-resources", path: "services" },
})
