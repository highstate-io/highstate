import { basename } from "node:path"
import { parseEndpoint } from "@highstate/common"
import { text } from "@highstate/contract"
import { common, distributions } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"
import * as ubuntu from "../../assets/ubuntu.json"

const { args, outputs, stateId } = forUnit(distributions.ubuntu)

const ubuntuImage = ubuntu[args.version][args.architecture]
const url = new URL(ubuntuImage.url)

export default outputs({
  image: makeEntityOutput({
    entity: common.fileEntity,
    identity: `${stateId}:image`,
    meta: {
      title: basename(url.pathname),
    },
    value: {
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
  }),
  cloudConfig: makeEntityOutput({
    entity: common.fileEntity,
    identity: `${stateId}:cloud-config`,
    meta: {
      title: `Ubuntu ${args.version} ${args.architecture} cloud-config`,
    },
    value: {
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
  }),
})
