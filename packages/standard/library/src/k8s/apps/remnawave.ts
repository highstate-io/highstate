import { defineEntity, defineUnit, type EntityInput, z } from "@highstate/contract"
import { pick } from "remeda"
import { optionalSharedInputs, sharedInputs, source } from "./shared"

export const remnawaveEntity = defineEntity({
  type: "k8s.apps.remnawave.v1",

  schema: z.object({
    /**
     * The ID of the Remnawave instance.
     */
    instanceId: z.string(),
  }),
})

/**
 * The Remnawave backend deployed on Kubernetes.
 */
export const remnawave = defineUnit({
  type: "k8s.apps.remnawave.backend.v1",

  secrets: {
    jwtAuthSecret: z.string(),
    jwtApiTokensSecret: z.string(),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint", "postgresqlDatabase", "redisDatabase"]),
    ...pick(optionalSharedInputs, ["resticRepo"]),
  },

  outputs: {
    remnawave: remnawaveEntity,
  },

  meta: {
    title: "Remnawave Backend",
    icon: "mdi:waveform",
    iconColor: "#0066cc",
    category: "VPN",
  },

  source: source("remnawave/backend"),
})

/**
 * The Remnawave node deployed on Kubernetes.
 */
export const node = defineUnit({
  type: "k8s.apps.remnawave.node.v1",

  inputs: {
    remnawave: remnawaveEntity,
    ...pick(sharedInputs, ["k8sCluster"]),
  },

  meta: {
    title: "Remnawave Node",
    icon: "mdi:waveform",
    iconColor: "#0066cc",
    secondaryIcon: "mdi:server-network",
    category: "VPN",
  },

  source: source("remnawave/node"),
})

export type Remnawave = z.infer<typeof remnawaveEntity.schema>
export type RemnawaveInput = EntityInput<typeof remnawaveEntity>
