import { describe, expect, test } from "vitest"
import {
  getPanelCorsOrigin,
  getPanelFrameContentSecurityPolicy,
  isPanelSessionSetCookie,
  isPanelSessionSource,
  removePanelSessionCookie,
  rewritePanelLocation,
  sanitizePanelResponseHeader,
} from "./panel-response"

describe("isPanelSessionSource", () => {
  const requestUrl = new URL("http://panel123.panels.highstate.localhost:7283/")

  test("allows the canonical Designer and owning panel on the same port", () => {
    expect(
      isPanelSessionSource("http://highstate.localhost:7283/project", "panel123", requestUrl),
    ).toBe(true)
    expect(
      isPanelSessionSource(
        "http://panel123.panels.highstate.localhost:7283/app",
        "panel123",
        requestUrl,
      ),
    ).toBe(true)
  })

  test("rejects unrelated origins and ports", () => {
    expect(
      isPanelSessionSource("http://other.panels.highstate.localhost:7283", "panel123", requestUrl),
    ).toBe(false)
    expect(isPanelSessionSource("http://highstate.localhost:3000", "panel123", requestUrl)).toBe(
      false,
    )
  })
})

describe("getPanelFrameContentSecurityPolicy", () => {
  const requestUrl = new URL("http://panel123.panels.highstate.localhost:7283/")

  test("allows the canonical Designer to frame generated errors", () => {
    expect(
      getPanelFrameContentSecurityPolicy("script-src 'none'; frame-ancestors 'none'", requestUrl),
    ).toBe("script-src 'none'; frame-ancestors http://highstate.localhost:7283")
  })

  test("creates a frame policy when the response has no CSP", () => {
    expect(getPanelFrameContentSecurityPolicy(undefined, requestUrl)).toBe(
      "frame-ancestors http://highstate.localhost:7283",
    )
  })
})

describe("sanitizePanelResponseHeader", () => {
  test("removes X-Frame-Options headers", () => {
    expect(sanitizePanelResponseHeader({ name: "X-Frame-Options", value: "deny" })).toBeUndefined()
  })

  test("removes upstream CORS headers controlled by Designer", () => {
    expect(
      sanitizePanelResponseHeader({ name: "Access-Control-Allow-Origin", value: "*" }),
    ).toBeUndefined()
    expect(
      sanitizePanelResponseHeader({ name: "Access-Control-Allow-Credentials", value: "true" }),
    ).toBeUndefined()
    expect(sanitizePanelResponseHeader({ name: "Vary", value: "Origin" })).toBeUndefined()
    expect(sanitizePanelResponseHeader({ name: "Vary", value: "Accept-Encoding, Origin" })).toEqual(
      {
        name: "Vary",
        value: "Accept-Encoding",
      },
    )
  })

  test("removes only frame-ancestors from Content-Security-Policy", () => {
    expect(
      sanitizePanelResponseHeader({
        name: "Content-Security-Policy",
        value: "default-src 'self'; frame-ancestors 'none'; script-src 'self'",
      }),
    ).toEqual({
      name: "Content-Security-Policy",
      value: "default-src 'self'; script-src 'self'",
    })
  })

  test("preserves unrelated headers", () => {
    const header = { name: "Content-Type", value: "text/html" }

    expect(sanitizePanelResponseHeader(header)).toBe(header)
  })
})

describe("getPanelCorsOrigin", () => {
  const requestUrl = new URL(
    "http://1785193731913.panel123.panels.highstate.localhost:7283/api/v1/pods",
  )

  test("allows the owning panel base origin", () => {
    expect(
      getPanelCorsOrigin("http://panel123.panels.highstate.localhost:7283", "panel123", requestUrl),
    ).toBe("http://panel123.panels.highstate.localhost:7283")
  })

  test("rejects other panels and ports", () => {
    expect(
      getPanelCorsOrigin("http://other.panels.highstate.localhost:7283", "panel123", requestUrl),
    ).toBeUndefined()
    expect(
      getPanelCorsOrigin("http://panel123.panels.highstate.localhost:3000", "panel123", requestUrl),
    ).toBeUndefined()
  })
})

describe("panel cookie policy", () => {
  test("removes only the reserved session cookie from requests", () => {
    expect(removePanelSessionCookie("highstate-panel-session=secret")).toBeUndefined()
    expect(
      removePanelSessionCookie("app_session=value; Highstate-Panel-Session=secret; csrf=value"),
    ).toBe("app_session=value; csrf=value")
  })

  test("blocks only the reserved Set-Cookie name", () => {
    expect(isPanelSessionSetCookie("highstate-panel-session=secret; Path=/")).toBe(true)
    expect(isPanelSessionSetCookie(" Highstate-Panel-Session=secret")).toBe(true)
    expect(isPanelSessionSetCookie("app_session=value; Path=/")).toBe(false)
    expect(isPanelSessionSetCookie("csrf=value; Path=/")).toBe(false)
  })
})

describe("rewritePanelLocation", () => {
  const requestUrl = new URL("http://panel.panels.highstate.localhost:7283/current")

  test.each([
    ["/login?next=%2F", "http://panel.panels.highstate.localhost:7283/login?next=%2F"],
    ["http://127.0.0.1:8080/login#form", "http://panel.panels.highstate.localhost:7283/login#form"],
    ["//127.0.0.1:8080/path", "http://panel.panels.highstate.localhost:7283/path"],
  ])("rewrites redirects to the registered authority", (location, expected) => {
    expect(rewritePanelLocation(location, "127.0.0.1:8080", requestUrl)).toBe(expected)
  })

  test.each([
    "https://identity.example.com/login",
    "http://127.0.0.1:8081/login",
    "http://not-127.0.0.1:8080/login",
  ])("preserves external redirects: %s", location => {
    expect(rewritePanelLocation(location, "127.0.0.1:8080", requestUrl)).toBe(location)
  })
})

describe("successful response frame policy", () => {
  const requestUrl = new URL("http://panel.panels.highstate.localhost:7283/")

  test.each([undefined, "default-src 'self'", "default-src 'self'; frame-ancestors 'none'"])(
    "always installs the exact Designer frame ancestor",
    policy => {
      const sanitized = policy
        ? sanitizePanelResponseHeader({ name: "Content-Security-Policy", value: policy })?.value
        : undefined
      const finalPolicy = getPanelFrameContentSecurityPolicy(sanitized, requestUrl)
      expect(finalPolicy).toContain("frame-ancestors http://highstate.localhost:7283")
      expect(finalPolicy).not.toContain("frame-ancestors 'none'")
    },
  )
})
