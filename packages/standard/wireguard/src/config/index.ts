import { text } from "@highstate/contract"
import { common, wireguard } from "@highstate/library"
import { forUnit, getCombinedIdentityOutput, makeEntityOutput, toPromise } from "@highstate/pulumi"
import { feedMetadataFromArgs, feedMetadataFromPeers, generateIdentityConfig } from "../shared"

const { name, stateId, inputs, args, outputs } = forUnit(wireguard.config)

const { identity, peers } = await toPromise(inputs)

const configContent = generateIdentityConfig({
  identity,
  peers,
  peerEndpointFilter: args.peerEndpointFilter,
  listen: args.listen,
  network: inputs.network ?? identity.peer.network,
})

const file = makeEntityOutput({
  entity: common.fileEntity,
  identity: stateId,
  meta: {
    title: `${name}.conf`,
  },
  value: {
    meta: {
      name: `${name}.conf`,
    },
    content: {
      type: "embedded",
      value: configContent,
    },
  },
})

export default outputs({
  config: makeEntityOutput({
    entity: wireguard.configEntity,
    identity: getCombinedIdentityOutput([file]),
    meta: {
      title: identity.peer.name,
    },
    value: {
      file,
      feedMetadata: feedMetadataFromPeers(peers) ?? feedMetadataFromArgs(args.feedMetadata),
    },
  }),
  $pages: {
    index: {
      meta: {
        title: "WireGuard Configuration",
      },

      content: [
        {
          type: "markdown",
          content: text`
            You can use this configuration to setup an external WireGuard device via \`wg-quick\` command.
          `,
        },
        {
          type: "qr",
          content: configContent,
          showContent: true,
          language: "ini",
        },
      ],
    },
  },
})
