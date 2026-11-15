import type { WgFeedEtcdKey } from "../shared"
import { readFile } from "node:fs/promises"
import {
  l3EndpointToString,
  MaterializedFile,
  parseEndpoint,
  parseEndpoints,
} from "@highstate/common"
import { Key } from "@highstate/etcd"
import { wireguard } from "@highstate/library"
import { forUnit, type Output, secret, toPromise } from "@highstate/pulumi"
import { createId } from "@paralleldrive/cuid2"
import { generateIdentity, identityToRecipient } from "age-encryption"
import { createFeedDocument, createFeedTunnel, encryptFeedDocument } from "../shared"

const { args, inputs, getSecret, outputs } = forUnit(wireguard.feed)

const serverEndpoints = parseEndpoints([...args.serverEndpoints, ...inputs.serverEndpoints], 4)
if (serverEndpoints.length === 0) {
  throw new Error("At least one server endpoint must be provided args or inputs")
}

const configs = await toPromise(inputs.configs)

// preserve the stable feed ID across updates
const feedId = await toPromise(getSecret("feedId", createId))

// materialize configs only where their content is embedded into the feed
const tunnels = await Promise.all(
  configs.map(async config => {
    if (!config.feedMetadata) {
      throw new Error("Feed metadata is required for all WireGuard feed configs")
    }

    // TODO: use some other API for extracting the file content without materializing it on disk
    const file = MaterializedFile.for(config.file)
    await using _ = await file.open()
    const content = await readFile(file.path, "utf-8")

    return createFeedTunnel(config.feedMetadata, content)
  }),
)

const document = createFeedDocument({
  feedId,
  displayInfo: args.displayInfo,
  warningMessage: args.warningMessage,
  serverEndpoints,
  tunnels,
})

let privateKey: Output<string> | undefined
let publicKey: string

if (args.publicKey) {
  publicKey = args.publicKey
} else {
  privateKey = getSecret("privateKey", generateIdentity)
  publicKey = await toPromise(privateKey.apply(identityToRecipient))
}

// encrypt the complete document before publishing it to etcd
const entry = await encryptFeedDocument(document, publicKey, args.ttlSeconds)

// store the feed in etcd
new Key("feed", {
  connection: inputs.etcd,
  key: `wg-feed/feeds/${feedId}` satisfies WgFeedEtcdKey,
  value: JSON.stringify(entry),
})

const encKey = await toPromise(
  privateKey?.apply(key => key.replace("AGE-SECRET-KEY-", "").toLowerCase()),
)

// create the subscription URL
const subscriptionUrl = encKey
  ? `https://${l3EndpointToString(serverEndpoints[0])}/${feedId}#${encKey}`
  : `https://${l3EndpointToString(serverEndpoints[0])}/${feedId}`

const subscriptionEndpoint = parseEndpoint(subscriptionUrl, 7)

export default outputs({
  endpoint: {
    ...subscriptionEndpoint,
    // the feed ID + encryption key part is secret
    path: secret(subscriptionEndpoint.path),
  },

  $statusFields: {
    url: {
      // TODO: make url secret when Highstate supports secret status fields
      value: subscriptionUrl,
    },
  },
})
