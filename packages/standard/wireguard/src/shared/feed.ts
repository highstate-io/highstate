import type { wireguard } from "@highstate/library"

export function feedMetadataFromArgs(
  feedMetadata: wireguard.SharedPeerArgs["feedMetadata"],
): wireguard.FeedMetadata | undefined {
  return feedMetadata.provided === "yes"
    ? {
        id: feedMetadata.id,
        name: feedMetadata.name,
        enabled: feedMetadata.enabled,
        forced: feedMetadata.forced,
        exclusive: feedMetadata.exclusive,
        warningMessage: feedMetadata.warningMessage,
        displayInfo: {
          title: feedMetadata.title,
          description: feedMetadata.description,
          iconUrl: feedMetadata.iconUrl,
        },
      }
    : undefined
}

export function feedMetadataFromPeers(peers: wireguard.Peer[]): wireguard.FeedMetadata | undefined {
  const feedPeers = peers.filter(peer => peer.feedMetadata)

  if (feedPeers.length === 0) {
    return undefined
  }

  if (feedPeers.length > 1) {
    throw new Error("Multiple peers have feed metadata, but only one is allowed")
  }

  return feedPeers[0].feedMetadata
}
