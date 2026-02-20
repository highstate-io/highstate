import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import { l4EndpointEntity } from "../../network"
import { appName, sharedArgs, sharedInputs, source } from "./shared"

/**
 * The WG Feed Server deployed on Kubernetes.
 */
export const wgFeedServer = defineUnit({
  type: "k8s.apps.wg-feed-server.v1",

  args: {
    ...appName("wg-feed-server"),
    ...pick(sharedArgs, ["fqdn"]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint", "etcdCluster"]),
  },

  outputs: {
    endpoint: l4EndpointEntity,
  },

  meta: {
    title: "WG Feed Server",
    icon: "simple-icons:wireguard",
    iconColor: "#88171a",
    secondaryIcon: "mdi:broadcast",
    category: "Wireguard",
  },

  source: source("wg-feed-server"),
})
