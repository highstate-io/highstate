import { getHostedAuthConfig, isHostedAuth } from "../utils/auth-config"

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    character =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  )

export default defineEventHandler(event => {
  setHeader(event, "Content-Type", "text/html; charset=utf-8")
  setHeader(event, "Cache-Control", "no-store")

  setHeader(
    event,
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  )

  const links = isHostedAuth()
    ? getHostedAuthConfig()
        .providers.map(
          provider =>
            `<li><a href="/api/auth/login?provider=${encodeURIComponent(provider.id)}">Continue with ${escapeHtml(provider.title)}</a></li>`,
        )
        .join("")
    : '<li><a href="/">Open local Designer</a></li>'

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sign in to Highstate</title></head><body style="font:18px system-ui;max-width:28rem;margin:15vh auto;padding:2rem"><main><h1>Sign in to Highstate</h1><ul>${links}</ul><form action="/api/auth/logout" method="post"><button type="submit">Sign out</button></form></main></body></html>`
})
