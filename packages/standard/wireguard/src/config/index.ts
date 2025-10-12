import { text } from "@highstate/contract"
import { wireguard } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { generateIdentityConfig } from "../shared"

const { inputs, args, outputs } = forUnit(wireguard.config)

const { identity, peers } = await toPromise(inputs)

const configContent = generateIdentityConfig({
  identity,
  peers,
  defaultInterface: args.defaultInterface,
})

export default outputs({
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
