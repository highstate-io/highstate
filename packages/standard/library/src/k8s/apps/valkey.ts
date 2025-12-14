import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import { databases } from "../.."
import { l4EndpointEntity } from "../../network"
import { serviceEntity } from "../service"
import {
  appName,
  optionalSharedInputs,
  sharedArgs,
  sharedInputs,
  sharedSecrets,
  source,
} from "./shared"

/**
 * The Valkey instance deployed on Kubernetes.
 */
export const valkey = defineUnit({
  type: "k8s.apps.valkey.v1",

  args: {
    ...appName("valkey"),
    ...pick(sharedArgs, ["external"]),
  },

  secrets: {
    ...pick(sharedSecrets, ["backupKey"]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster"]),
    ...pick(optionalSharedInputs, ["resticRepo"]),
  },

  outputs: {
    redis: databases.redisEntity,
    service: serviceEntity,
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  meta: {
    title: "Valkey (Redis)",
    icon: "simple-icons:redis",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },

  source: source("valkey/app"),
})
