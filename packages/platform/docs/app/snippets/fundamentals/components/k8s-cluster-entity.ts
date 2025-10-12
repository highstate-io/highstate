import { defineEntity, z } from "@highstate/contract"

export const clusterEntity = defineEntity({
  // 1. each entity also must have a unique type across the project
  type: "k8s.cluster.v1",

  // 2. schema defines what data this entity contains
  schema: z.object({
    id: z.string(),
    kubeconfig: z.string(),
  }),

  // 3. visual metadata for the designer
  meta: {
    color: "#2196F3",
  },
})
