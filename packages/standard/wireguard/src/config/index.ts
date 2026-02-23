import { text } from "@highstate/contract"
import { common, wireguard } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { getCombinedIdentityOutput, makeEntityOutput } from "@highstate/common"
import { generateIdentityConfig } from "../shared"

const { name, stateId, inputs, args, outputs } = forUnit(wireguard.config)

const { identity, peers } = await toPromise(inputs)

const configContent = generateIdentityConfig({
  identity,
  peers,
  peerEndpointFilter: args.peerEndpointFilter,
  listen: args.listen,
})

const file = makeEntityOutput({
  entity: common.fileEntity,
  identity: stateId,
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
    value: { file },
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
