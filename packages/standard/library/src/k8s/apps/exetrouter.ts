import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import { persistentVolumeClaimEntity } from "../resources"
import { serviceEntity } from "../service"
import { statefulSetEntity } from "../workload"
import {
  appName,
  optionalSharedInputs,
  sharedArgs,
  sharedInputs,
  sharedSecrets,
  source,
} from "./shared"

/**
 * ExetRouter with an OpenAI-compatible API and restricted SSH management.
 */
export const exetrouter = defineUnit({
  type: "k8s.apps.exetrouter.v1",

  args: {
    ...appName("exetrouter"),
    ...pick(sharedArgs, ["fqdn", "dnsChallengeAlias", "service", "scheduling"]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint"]),
    ...pick(optionalSharedInputs, ["volume", "resticRepo"]),
  },

  secrets: pick(sharedSecrets, ["backupKey"]),

  outputs: {
    statefulSet: statefulSetEntity,
    volume: persistentVolumeClaimEntity,
    managementService: serviceEntity,
  },

  meta: {
    title: "ExetRouter",
    icon: "mdi:router-network",
    category: "AI",
  },

  source: source("exetrouter"),
})
