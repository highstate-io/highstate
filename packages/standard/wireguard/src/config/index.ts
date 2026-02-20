import { text } from "@highstate/contract"
import { wireguard } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { feedMetadataFromArgs, feedMetadataFromPeers, generateIdentityConfig } from "../shared"

const { name, inputs, args, outputs } = forUnit(wireguard.config)

const { identity, peers } = await toPromise(inputs)

const configContent = generateIdentityConfig({
  identity,
  peers,
  peerEndpointFilter: args.peerEndpointFilter,
  listen: args.listen,
})

export default outputs({
  config: {
    file: {
      meta: {
        name: `${name}.conf`,
      },
      content: {
        type: "embedded",
        value: configContent,
      },
    },
    feedMetadata: feedMetadataFromArgs(args.feedMetadata) ?? feedMetadataFromPeers(peers),
  },
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
