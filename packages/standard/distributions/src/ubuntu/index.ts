import { basename } from "node:path"
import { parseEndpoint } from "@highstate/common"
import { text } from "@highstate/contract"
import { distributions } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import * as ubuntu from "../../assets/ubuntu.json"

const { args, outputs } = forUnit(distributions.ubuntu)

const ubuntuImage = ubuntu[args.version][args.architecture]
const url = new URL(ubuntuImage.url)

export default outputs({
  image: {
    meta: {
      name: basename(url.pathname),
    },
    content: {
      type: "remote",
      endpoint: parseEndpoint(ubuntuImage.url, 7),
      checksum: {
        algorithm: "sha256",
        value: ubuntuImage.sha256,
      },
    },
  },
  cloudConfig: {
    meta: {
      name: `cloud-config-ubuntu-${args.version}-${args.architecture}.yaml`,
    },
    content: {
      type: "embedded",
      value: text`
        #cloud-config
        runcmd:
          - apt update
          - apt install -y qemu-guest-agent
          - systemctl start qemu-guest-agent
          - reboot
        # Taken from https://forum.proxmox.com/threads/combining-custom-cloud-init-with-auto-generated.59008/page-3#post-428772
      `,
    },
  },
})
