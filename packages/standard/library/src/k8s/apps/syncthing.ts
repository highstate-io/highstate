import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { l4EndpointEntity } from "../../network"
import { persistentVolumeClaimEntity } from "../resources"
import { serviceEntity } from "../service"
import {
  appName,
  optionalSharedInputs,
  sharedArgs,
  sharedInputs,
  sharedSecrets,
  source,
} from "./shared"

export const backupModeSchema = z.enum(["state", "full"])

/**
 * The Syncthing instance deployed on Kubernetes.
 */
export const syncthing = defineUnit({
  type: "k8s.apps.syncthing.v1",

  args: {
    ...appName("syncthing"),
    ...pick(sharedArgs, ["fqdn", "external"]),

    /**
     * The FQDN of the Syncthing instance used to sync with other devices.
     *
     * The `fqdn` argument unlike this one points to the gateway and used to
     * access the Syncthing Web UI.
     */
    deviceFqdn: z.string().optional(),

    /**
     * The backup mode to use for the Syncthing instance.
     *
     * - `state`: Only the state is backed up. When the instance is restored, it will
     * sync files from the other devices automatically.
     * - `full`: A full backup is created including all files.
     *
     * The default is `state`.
     */
    backupMode: backupModeSchema.default("state"),
  },

  secrets: {
    ...pick(sharedSecrets, ["backupKey"]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint"]),
    ...pick(optionalSharedInputs, ["resticRepo", "volume"]),
  },

  outputs: {
    volume: persistentVolumeClaimEntity,
    service: serviceEntity,
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  meta: {
    title: "Syncthing",
    icon: "simple-icons:syncthing",
    category: "File Sync",
  },

  source: source("syncthing"),
})
