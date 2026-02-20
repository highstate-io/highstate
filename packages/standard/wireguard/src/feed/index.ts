import type { WgFeedDocument, WgFeedEtcdEntry, WgFeedEtcdKey } from "./models"
import { readFile } from "node:fs/promises"
import {
  l3EndpointToString,
  l4EndpointToString,
  MaterializedFile,
  parseEndpoint,
  parseEndpoints,
} from "@highstate/common"
import { Key, Provider } from "@highstate/etcd-sdk"
import { wireguard } from "@highstate/library"
import { forUnit, type Output, secret, toPromise } from "@highstate/pulumi"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { createId } from "@paralleldrive/cuid2"
import { armor, Encrypter, generateIdentity, identityToRecipient } from "age-encryption"
import { join, map } from "remeda"
import { v5 as uuidv5 } from "uuid"

const { args, inputs, getSecret, outputs } = forUnit(wireguard.feed)

const serverEndpoints = await parseEndpoints(args.serverEndpoints, inputs.serverEndpoints, 4)
if (serverEndpoints.length === 0) {
  throw new Error("At least one server endpoint must be provided args or inputs")
}

const provider = new Provider("etcd", {
  endpoints: inputs.etcd.endpoints.apply(map(l4EndpointToString)).apply(join(", ")),
  skipTls: true,
})

const configs = await toPromise(inputs.configs)

const namespace = "2b5e358c-3510-48fb-b1cf-a8aee788925a"

// calculate the feed ID and document ID
const feedId = await toPromise(getSecret("feedId", createId))
const documentId = uuidv5(feedId, namespace)

// create the feed document according to wg-feed spec
const document: WgFeedDocument = await toPromise({
  id: documentId,

  display_info: {
    title: args.displayInfo.title,
    description: args.displayInfo.description,
    icon_url: args.displayInfo.iconUrl,
  },

  endpoints: serverEndpoints.map(endpoint => `https://${l3EndpointToString(endpoint)}/${feedId}`),

  tunnels: configs.map(async config => {
    if (!config.feedMetadata) {
      throw new Error("Feed metadata is required for all WireGuard feed configs")
    }

    // TODO: use some other API for extracting the file content without materializing it on disk
    await using file = await MaterializedFile.open(config.file)
    const content = await readFile(file.path, "utf-8")

    return {
      id: config.feedMetadata.id,
      name: config.feedMetadata.name,

      enabled: config.feedMetadata.enabled,
      forced: config.feedMetadata.forced,

      display_info: {
        title: config.feedMetadata.displayInfo.title,
        description: config.feedMetadata.displayInfo.description,
        icon_url: config.feedMetadata.displayInfo.iconUrl,
      },

      wg_quick_config: content,
    }
  }),
})

let privateKey: Output<string> | undefined
let publicKey: string

if (args.publicKey) {
  publicKey = args.publicKey
} else {
  privateKey = getSecret("privateKey", generateIdentity)
  publicKey = await toPromise(privateKey.apply(identityToRecipient))
}

// encrypt the document with age
const encrypter = new Encrypter()
encrypter.addRecipient(publicKey)

const encrypted = await encrypter.encrypt(JSON.stringify(document))
const revision = bytesToHex(sha256(encrypted))
const armored = armor.encode(encrypted)

// create the etcd entry
const entry: WgFeedEtcdEntry = {
  revision,
  ttl_seconds: args.ttlSeconds,
  encrypted: true,
  encrypted_data: armored,
}

// store the feed in etcd
new Key(
  "feed",
  {
    key: `wg-feed/feeds/${feedId}` satisfies WgFeedEtcdKey,
    value: JSON.stringify(entry),
  },
  { provider },
)

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
