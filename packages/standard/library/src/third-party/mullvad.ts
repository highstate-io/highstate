import { defineUnit, z } from "@highstate/contract"
import { l4EndpointEntity } from "../network"
import { networkEntity, peerEntity } from "../wireguard"

/**
 * The Mullvad WireGuard peer fetched from the Mullvad API.
 */
export const peer = defineUnit({
  type: "mullvad.peer.v1",

  args: {
    hostname: z.string().optional(),

    /**
     * Whether to include Mullvad DNS servers in the peer configuration.
     */
    includeDns: z.boolean().default(true),
  },

  inputs: {
    /**
     * The network to use for the WireGuard peer.
     *
     * If not provided, the peer will use default network configuration.
     */
    network: {
      entity: networkEntity,
      required: false,
    },
  },

  outputs: {
    peer: peerEntity,

    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  meta: {
    title: "Mullvad Peer",
    icon: "simple-icons:mullvad",
    secondaryIcon: "cib:wireguard",
    secondaryIconColor: "#88171a",
    category: "VPN",
  },

  source: {
    package: "@highstate/mullvad",
    path: "peer",
  },
})
