const localDesignerHosts = new Set(["localhost", "127.0.0.1"])

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
  canonicalUrl.hostname = "highstate.localhost"

  return canonicalUrl.toString()
}
