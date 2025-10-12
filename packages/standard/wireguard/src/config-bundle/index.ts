import { type PageBlock, text } from "@highstate/contract"
import { wireguard } from "@highstate/library"
import { type DeepInput, fileFromBuffer, forUnit, secret, toPromise } from "@highstate/pulumi"
import ZipStream from "zip-stream"
import { generateIdentityConfig } from "../shared"

const { name, inputs, args, outputs } = forUnit(wireguard.configBundle)

const { identity, peers, sharedPeers } = await toPromise(inputs)

const blocks: DeepInput<PageBlock>[] = []
const zipStream = new ZipStream()

for (const peer of peers) {
  const configContent = generateIdentityConfig({
    identity,
    peers: [...sharedPeers, peer],
    defaultInterface: args.defaultInterface,
  })

  await new Promise((resolve, reject) => {
    return zipStream.entry(
      configContent,
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
      content: secret(configContent),
      showContent: true,
      language: "ini",
    },
  )
}

zipStream.finish()

const content = await new Promise<Buffer>((resolve, reject) => {
  const buffers: Buffer[] = []

  zipStream.on("data", data => buffers.push(data as Buffer))
  zipStream.on("error", err => reject(err as Error))
  zipStream.on("end", () => resolve(Buffer.concat(buffers)))
})

const zipFile = fileFromBuffer(`${name}.zip`, content, {
  contentType: "application/zip",
  isSecret: true,
})

export default outputs({
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
