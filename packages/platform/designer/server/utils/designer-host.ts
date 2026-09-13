const localDesignerHosts = new Set(["localhost", "127.0.0.1"])
const canonicalDesignerHost = "highstate.localhost"

/**
 * Returns the canonical Designer URL when accessed through a loopback hostname.
 *
 * The canonical hostname keeps Designer and panel subdomains same-site so strict panel session
 * cookies are included in iframe requests.
 *
 * @param requestUrl The incoming Designer request URL.
 * @param redirectDisabled Whether canonical host redirects are disabled.
 * @returns The canonical URL, or `undefined` when no redirect is needed.
 */
export function getCanonicalDesignerUrl(
  requestUrl: URL,
  redirectDisabled = false,
): string | undefined {
  if (redirectDisabled || !localDesignerHosts.has(requestUrl.hostname)) {
    return undefined
  }

  const canonicalUrl = new URL(requestUrl)
  canonicalUrl.hostname = canonicalDesignerHost

  return canonicalUrl.toString()
}

/**
 * Returns whether an origin may connect to a Designer WebSocket endpoint.
 *
 * @param origin The browser origin header.
 * @param requestUrl The incoming WebSocket request URL.
 * @param redirectDisabled Whether canonical host redirects are disabled.
 * @returns Whether the origin uses an allowed Designer host, protocol, and port.
 */
export function isDesignerOrigin(
  origin: string,
  requestUrl: string,
  redirectDisabled = false,
): boolean {
  try {
    const originUrl = new URL(origin)
    const targetUrl = new URL(requestUrl)
    const canonicalOrigin = originUrl.hostname === canonicalDesignerHost
    const localOrigin =
      redirectDisabled &&
      localDesignerHosts.has(originUrl.hostname) &&
      originUrl.hostname === targetUrl.hostname

    return (
      originUrl.protocol === targetUrl.protocol.replace("ws", "http") &&
      ((canonicalOrigin && originUrl.port === targetUrl.port) || localOrigin)
    )
  } catch {
    return false
  }
}
