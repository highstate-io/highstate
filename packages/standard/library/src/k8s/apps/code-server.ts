import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { persistentVolumeClaimEntity } from "../resources"
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
 * The Code Server instance deployed on Kubernetes.
 */
export const codeServer = defineUnit({
  type: "k8s.apps.code-server.v1",

  args: {
    ...appName("code-server"),
    ...pick(sharedArgs, ["fqdn"]),
  },

  secrets: {
    ...pick(sharedSecrets, ["backupKey"]),
    password: z.string().optional(),
    sudoPassword: z.string().optional(),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint"]),
    ...pick(optionalSharedInputs, ["resticRepo", "dnsProviders", "volume"]),
  },

  outputs: {
    statefulSet: statefulSetEntity,
    volume: persistentVolumeClaimEntity,
  },

  meta: {
    title: "Code Server",
    icon: "material-icon-theme:vscode",
    category: "Development",
  },

  source: source("code-server"),
})
