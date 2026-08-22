type PanelResponseHeader = {
  name: string
  value: string
}

export function removePanelSessionCookie(header: string | undefined): string | undefined {
  const value = header
    ?.split(";")
    .map(cookie => cookie.trim())
    .filter(cookie => !cookie.toLowerCase().startsWith("highstate-panel-session="))
    .join("; ")

  return value || undefined
}

export function isPanelSessionSetCookie(value: string): boolean {
  return value.trimStart().toLowerCase().startsWith("highstate-panel-session=")
}

export function rewritePanelLocation(
  value: string,
  upstreamAuthority: string,
  requestUrl: URL,
): string {
  let location: URL
  try {
    location = new URL(value, `http://${upstreamAuthority}`)
  } catch {
    return value
  }
  if (location.host !== upstreamAuthority) {
    return value
  }

  return `${requestUrl.origin}${location.pathname}${location.search}${location.hash}`
}

export function getPanelCorsOrigin(
  origin: string | undefined,
  panelId: string,
  requestUrl: URL,
): string | undefined {
  if (!origin) {
    return undefined
  }

  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return undefined
  }

  if (
    originUrl.protocol !== requestUrl.protocol ||
    originUrl.port !== requestUrl.port ||
    originUrl.hostname !== `${panelId}.panels.highstate.localhost`
  ) {
    return undefined
  }

  return originUrl.origin
}

export function isPanelSessionSource(
  source: string | undefined,
  panelId: string,
  requestUrl: URL,
): boolean {
  if (!source) {
    return false
  }

  let sourceUrl: URL
  try {
    sourceUrl = new URL(source)
  } catch {
    return false
  }

  if (sourceUrl.protocol !== requestUrl.protocol || sourceUrl.port !== requestUrl.port) {
    return false
  }

  return (
    sourceUrl.hostname === "highstate.localhost" ||
    sourceUrl.hostname === `${panelId}.panels.highstate.localhost`
  )
}

export function getPanelFrameContentSecurityPolicy(
  contentSecurityPolicy: string | undefined,
  requestUrl: URL,
): string {
  const designerOrigin = new URL(requestUrl)
  designerOrigin.hostname = "highstate.localhost"

  const directives = contentSecurityPolicy
    ?.split(";")
    .map(directive => directive.trim())
    .filter(directive => directive && !directive.toLowerCase().startsWith("frame-ancestors"))

  return [...(directives ?? []), `frame-ancestors ${designerOrigin.origin}`].join("; ")
}

/**
 * Removes upstream response restrictions that prevent panels from rendering in Designer frames.
 *
 * @param header The upstream panel response header.
 * @returns The sanitized response header, or `undefined` when it should not be forwarded.
 */
export function sanitizePanelResponseHeader(
  header: PanelResponseHeader,
): PanelResponseHeader | undefined {
  const name = header.name.toLowerCase()
  if (
    name === "x-frame-options" ||
    name === "access-control-allow-origin" ||
    name === "access-control-allow-credentials"
  ) {
    return undefined
  }
  if (name === "vary") {
    const value = header.value
      .split(",")
      .map(token => token.trim())
      .filter(token => token && token.toLowerCase() !== "origin")
      .join(", ")

    return value ? { ...header, value } : undefined
  }
  if (name !== "content-security-policy") {
    return header
  }

  const value = header.value
    .split(";")
    .map(directive => directive.trim())
    .filter(directive => directive && !directive.toLowerCase().startsWith("frame-ancestors"))
    .join("; ")

  return value ? { ...header, value } : undefined
}
