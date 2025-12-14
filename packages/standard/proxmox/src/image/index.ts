import { l7EndpointToString } from "@highstate/common"
import { type common, proxmox } from "@highstate/library"
import { forUnit, output, toPromise } from "@highstate/pulumi"
import { download } from "@muhlba91/pulumi-proxmoxve"
import { createProvider } from "../provider"

const { args, inputs, outputs } = forUnit(proxmox.image)

const provider = await createProvider(inputs.proxmoxCluster)

let url: string | undefined = args.url
let checksum: common.Checksum | undefined = args.checksum

if (!url) {
  const file = await toPromise(inputs.file)
  if (!file) {
    throw new Error("No file provided and no URL specified.")
  }

  if (file.content.type !== "remote") {
    throw new Error(`For now only "remote" files are supported, got "${file.content.type}".`)
  }

  url = l7EndpointToString(file.content.endpoint)
  checksum = file.content.checksum
}

const file = new download.File(
  "image",
  {
    contentType: "iso",
    checksumAlgorithm: checksum?.algorithm,
    checksum: checksum?.value,

    datastoreId: args.datastoreId ?? inputs.proxmoxCluster.defaultDatastoreId,

    url,
    nodeName: args.nodeName ?? inputs.proxmoxCluster.defaultNodeName,

    fileName: output(url)
      .apply(getNameByUrl)
      .apply(([name, extension]) => {
        if (checksum) {
          return `${name}-${checksum.value}.${extension}`
        }

        return `${name}.${extension}`
      }),
  },
  { provider },
)

function getNameByUrl(url: string): [name: string, extension: string] {
  const fullName = url.split("/").pop()?.split("?")[0]
  const parts = fullName?.split(".")

  if (!parts || parts.length < 2) {
    throw new Error(`Cannot extract file name and extension from URL: ${url}`)
  }

  const name = parts.slice(0, parts.length - 1).join(".")
  const extension = parts[parts.length - 1]

  return [name, extension]
}

export default outputs({
  image: {
    id: file.id,
  },
})
