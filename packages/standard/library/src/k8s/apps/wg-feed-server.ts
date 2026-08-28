import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { folderEntity } from "../../common"
import { l4EndpointEntity } from "../../network"
import { appName, sharedArgs, sharedInputs, source } from "./shared"

/**
 * The WG Feed Server deployed on Kubernetes.
 */
export const wgFeedServer = defineUnit({
  type: "k8s.apps.wg-feed-server.v1",

  args: {
    ...appName("wg-feed-server"),
    ...pick(sharedArgs, ["fqdn", "replicas", "scheduling"]),

    /**
     * The regular expression matching paths served by the WG feed server.
     *
     * Must be provided together with `fallbackSite`.
     */
    pathPattern: z.string().optional(),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint", "etcd"]),

    /**
     * The static site served for paths that do not match `pathPattern`.
     *
     * Must be provided together with `pathPattern`.
     */
    fallbackSite: {
      entity: folderEntity,
      required: false,
    },
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
