import { text } from "@highstate/contract"
import { wireguard } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { generateIdentityConfig } from "../shared"

const { name, inputs, args, outputs } = forUnit(wireguard.config)

const { identity, peers } = await toPromise(inputs)

const configContent = generateIdentityConfig({
  identity,
  peers,
  peerEndpointFilter: args.peerEndpointFilter,
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
    feedMetadata:
      args.feedMetadata.enabled === "true"
        ? {
            id: args.feedMetadata.id,
            name: args.feedMetadata.name,
            displayInfo: {
              title: args.feedMetadata.title,
              description: args.feedMetadata.description,
              iconUrl: args.feedMetadata.iconUrl,
            },
          }
        : undefined,
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
