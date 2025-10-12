import { l34EndpointToString, parseL34Endpoint } from "@highstate/common"
import { restic } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { uniqueBy } from "remeda"

const { args, inputs, secrets, outputs } = forUnit(restic.repository)

const remoteInfo = await toPromise(
  secrets.rcloneConfig.apply(config => {
    const remoteNames = Array.from(config.matchAll(/(?<=\[).+?(?=\])/g))

    if (remoteNames.length === 0) {
      throw new Error("No remotes found in rclone config")
    }

    if (remoteNames.length > 1) {
      throw new Error("Multiple remotes found in rclone config")
    }

    const remoteName = remoteNames[0][0]

    // extract the type from the remote section
    const remoteSection = config.split(`[${remoteName}]`)[1]?.split(/\n\s*\[/)[0] || ""
    const typeMatch = remoteSection.match(/^\s*type\s*=\s*(.+)$/m)

    if (!typeMatch) {
      throw new Error(`No type found for remote '${remoteName}'`)
    }

    return {
      name: remoteName,
      type: typeMatch[1].trim(),
    }
  }),
)

const { remoteL3Endpoints, remoteL4Endpoints } = await toPromise(inputs)

const autoDiscoveredEndpoints: Record<string, string[]> = {
  yandex: [
    "cloud-api.yandex.com",
    "downloader.disk.yandex.ru",
    "*.storage.yandex.net",
    "*.disk.yandex.net",
  ],
}

const remoteEndpoints = uniqueBy(
  [
    //
    ...(autoDiscoveredEndpoints[remoteInfo.type] ?? []).map(parseL34Endpoint),
    ...args.remoteEndpoints.map(parseL34Endpoint),
    ...remoteL3Endpoints,
    ...remoteL4Endpoints,
  ],
  l34EndpointToString,
)

export default outputs({
  repo: {
    type: "rclone",
    pathPattern: args.pathPattern,
    rcloneConfig: secrets.rcloneConfig,
    remoteName: remoteInfo.name,
    remoteEndpoints,
  },

  $statusFields: {
    remoteName: remoteInfo.name,
    remoteType: remoteInfo.type,

    remoteEndpoints: {
      value: remoteEndpoints.map(l34EndpointToString),
      complementaryTo: "remoteEndpoints",
    },
  },
})
