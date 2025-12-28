import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { appName, optionalSharedInputs, sharedArgs, sharedInputs, sharedSecrets } from "../apps"

export const openttd = defineUnit({
  type: "k8s.game-servers.openttd.v1",

  args: {
    ...appName("openttd-server"),
    ...pick(sharedArgs, ["fqdn"]),

    port: z.number().default(3979).describe("The port the game server will be exposed on."),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "dnsProviders"]),
    ...pick(optionalSharedInputs, ["resticRepo"]),
  },

  secrets: {
    ...pick(sharedSecrets, ["backupKey"]),
  },

  source: {
    package: "@highstate/k8s.game-servers",
    path: "openttd",
  },

  meta: {
    title: "OpenTTD Server",
    description: "The dedicated server for the OpenTTD game.",
    icon: "arcticons:openttd",
  },
})
