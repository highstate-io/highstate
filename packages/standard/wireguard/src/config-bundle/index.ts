import { type PageBlock, text } from "@highstate/contract"
import { common, wireguard } from "@highstate/library"
import {
  type DeepInput,
  forUnit,
  getCombinedIdentity,
  makeEntityOutput,
  makeFile,
  toPromise,
} from "@highstate/pulumi"
import ZipStream from "zip-stream"
import { generateIdentityConfig } from "../shared"

const { name, stateId, args, inputs, outputs } = forUnit(wireguard.configBundle)

const { identity, peers, sharedPeers } = await toPromise(inputs)

const blocks: DeepInput<PageBlock>[] = []
const configs: DeepInput<wireguard.Config>[] = []
const zipStream = new ZipStream()

for (const peer of peers) {
  const configContent = generateIdentityConfig({
    identity,
    peers: [...sharedPeers, peer],
    peerEndpointFilter: args.peerEndpointFilter,
    listen: args.listen,
  })

  const unsafeConfigContent = await toPromise(configContent)

  await new Promise((resolve, reject) => {
    return zipStream.entry(
      unsafeConfigContent,
      {
        name: `${peer.name}.conf`,

        // to prevent zip-stream from using the current date, for reproducibility
        date: new Date(0),
      },
      err => {
        if (err) {
          reject(err)
        } else {
          resolve(null)
        }
      },
    )
  })

  blocks.push(
    {
      type: "markdown",
      content: `### ${peer.name}`,
    },
    {
      type: "qr",
      content: configContent,
      showContent: true,
      language: "ini",
    },
  )

  configs.push(
    makeEntityOutput({
      entity: wireguard.configEntity,
      identity: getCombinedIdentity([stateId, peer.name]),
      meta: {
        title: peer.name,
      },
      value: {
        file: makeEntityOutput({
          entity: common.fileEntity,
          identity: getCombinedIdentity([stateId, peer.name]),
          meta: {
            title: `${peer.name}.conf`,
          },
          value: {
            meta: {
              name: `${peer.name}.conf`,
            },
            content: {
              type: "embedded",
              value: configContent,
            },
          },
        }),
      },
    }),
  )
}

zipStream.finish()

const unsafeZipFileContent = await new Promise<Buffer>((resolve, reject) => {
  const buffers: Buffer[] = []

  zipStream.on("data", data => buffers.push(data as Buffer))
  zipStream.on("error", err => reject(err as Error))
  zipStream.on("end", () => resolve(Buffer.concat(buffers)))
})

const zipFile = makeFile({
  name: `${name}.zip`,
  identity: getCombinedIdentity([stateId, "zip"]),
  content: unsafeZipFileContent,
  contentType: "application/zip",
  isSecret: true,
})

export default outputs({
  configs,

  $pages: {
    index: {
      meta: {
        title: "WireGuard Configuration Bundle",
      },
      content: [
        {
          type: "markdown",
          content: text`
            You can use the following configurations to setup an external WireGuard device via \`wg-quick\` command or
            using the WireGuard app on your desktop or mobile device.
            
            You can also bulk import all configurations from zip file using the WireGuard app.
          `,
        },
        {
          type: "file",
          file: zipFile,
        },
        ...blocks,
      ],
    },
  },
})
