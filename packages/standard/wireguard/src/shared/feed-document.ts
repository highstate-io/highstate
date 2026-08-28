import type { network, wireguard } from "@highstate/library"
import type { WgFeedDocument, WgFeedEtcdEntry, WgFeedTunnel } from "./feed-models"
import { l3EndpointToString } from "@highstate/common"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { createId } from "@paralleldrive/cuid2"
import { armor, Encrypter, generateIdentity, identityToRecipient } from "age-encryption"
import { v5 as uuidv5 } from "uuid"

const feedDocumentNamespace = "2b5e358c-3510-48fb-b1cf-a8aee788925a"

export type FeedCredentials = {
  feedId: string
  privateKey: string
}

export async function generateFeedCredentials(): Promise<FeedCredentials> {
  return {
    feedId: createId(),
    privateKey: await generateIdentity(),
  }
}

export async function feedPrivateKeyToPublicKey(privateKey: string): Promise<string> {
  return await identityToRecipient(privateKey)
}

export type CreateFeedDocumentArgs = {
  feedId: string
  displayInfo: wireguard.FeedDisplayInfo
  warningMessage?: string
  serverEndpoints: network.L4Endpoint[]
  tunnels: WgFeedTunnel[]
}

export function createFeedTunnel(metadata: wireguard.FeedMetadata, config: string): WgFeedTunnel {
  return {
    id: metadata.id,
    name: metadata.name,
    enabled: metadata.enabled,
    forced: metadata.forced,
    exclusive: metadata.exclusive,
    warning_message: metadata.warningMessage,
    display_info: {
      title: metadata.displayInfo.title,
      description: metadata.displayInfo.description,
      icon_url: metadata.displayInfo.iconUrl,
    },
    wg_quick_config: config,
  }
}

export function createFeedDocument(args: CreateFeedDocumentArgs): WgFeedDocument {
  return {
    id: uuidv5(args.feedId, feedDocumentNamespace),
    display_info: {
      title: args.displayInfo.title,
      description: args.displayInfo.description,
      icon_url: args.displayInfo.iconUrl,
    },
    warning_message: args.warningMessage,
    endpoints: args.serverEndpoints.map(
      endpoint => `https://${l3EndpointToString(endpoint)}/${args.feedId}`,
    ),
    tunnels: args.tunnels,
  }
}

export async function encryptFeedDocument(
  document: WgFeedDocument,
  publicKey: string,
  ttlSeconds: number,
): Promise<WgFeedEtcdEntry> {
  const encrypter = new Encrypter()
  encrypter.addRecipient(publicKey)

  const encrypted = await encrypter.encrypt(JSON.stringify(document))

  return {
    revision: bytesToHex(sha256(encrypted)),
    ttl_seconds: ttlSeconds,
    encrypted: true,
    encrypted_data: armor.encode(encrypted),
  }
}
