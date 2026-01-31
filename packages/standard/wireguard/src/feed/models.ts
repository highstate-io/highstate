export type WgFeedVersion = "wg-feed-00"

export type WgFeedResponseDocument = WgFeedSuccessResponse | WgFeedErrorResponse

export type WgFeedSuccessResponse =
  | WgFeedSuccessResponseUnencrypted
  | WgFeedSuccessResponseEncrypted

export type WgFeedSuccessResponseUnencrypted = {
  version: WgFeedVersion
  success: true
  revision: string
  ttl_seconds: number
  supports_sse?: boolean
  data: WgFeedDocument
  encrypted?: never
  encrypted_data?: never
} & Record<string, unknown>

export type WgFeedSuccessResponseEncrypted = {
  version: WgFeedVersion
  success: true
  revision: string
  ttl_seconds: number
  supports_sse?: boolean
  encrypted: true
  encrypted_data: string
  data?: never
} & Record<string, unknown>

export type WgFeedErrorResponse = {
  version: WgFeedVersion
  success: false
  message: string
  retriable: boolean
} & Record<string, unknown>

export type WgFeedDocument = {
  id: string
  endpoints: string[]
  warning_message?: string
  display_info: WgFeedDisplayInfo
  tunnels: WgFeedTunnel[]
} & Record<string, unknown>

export type WgFeedDisplayInfo = {
  title: string
  description?: string
  icon_url?: string
} & Record<string, unknown>

export type WgFeedTunnel = {
  id: string
  name: string
  display_info: WgFeedDisplayInfo
  enabled?: boolean
  forced?: boolean
  wg_quick_config: string
} & Record<string, unknown>

export type WgFeedEtcdKey = `wg-feed/feeds/${string}`

export type WgFeedEtcdEntry = WgFeedEtcdEntryUnencrypted | WgFeedEtcdEntryEncrypted

export type WgFeedEtcdEntryUnencrypted = {
  revision: string
  ttl_seconds: number
  encrypted: false
  data: WgFeedDocument
}

export type WgFeedEtcdEntryEncrypted = {
  revision: string
  ttl_seconds: number
  encrypted: true
  encrypted_data: string
}
