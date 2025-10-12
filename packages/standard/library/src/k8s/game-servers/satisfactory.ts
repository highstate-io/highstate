import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { appName, optionalSharedInputs, sharedArgs, sharedInputs, sharedSecrets } from "../apps"

export const satisfactory = defineUnit({
  type: "k8s.game-servers.satisfactory.v1",

  args: {
    ...appName("satisfactory-server"),
    ...pick(sharedArgs, ["fqdn"]),

    port: z.number().default(7777).describe("The port the game server will be exposed on."),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint"]),
    ...pick(optionalSharedInputs, ["resticRepo"]),
  },

  secrets: {
    ...pick(sharedSecrets, ["backupKey"]),
  },

  source: {
    package: "@highstate/k8s.game-servers",
    path: "satisfactory",
  },

  meta: {
    title: "Satisfactory Server",
    description: "The dedicated server for the Satisfactory game.",
    icon: "mdi:google-gamepad",
  },
})
