import { network } from "@highstate/library"
import { omit } from "remeda"
import { describe, expect, it } from "vitest"
import { addressToCidr, parseAddress } from "./address"
import {
  endpointToString,
  l3EndpointToCidr,
  l3EndpointToString,
  l4EndpointToFullString,
  l4EndpointToString,
  l7EndpointToString,
  mergeEndpoints,
  parseEndpoint,
  rebaseEndpoint,
} from "./endpoints"
import { subnetToString } from "./subnet"

describe("endpoints", () => {
  it("parses IPv4 L3 endpoint and embeds address entity", () => {
    const endpoint = parseEndpoint("10.0.0.1")

    expect(endpoint.level).toBe(3)
    expect(endpoint.type).toBe("ipv4")
    expect(endpoint.address?.value).toBe("10.0.0.1")
    expect(addressToCidr(endpoint.address!)).toBe("10.0.0.1/32")
    expect(subnetToString(endpoint.subnet!)).toBe("10.0.0.1/32")

    expect(l3EndpointToString(endpoint)).toBe("10.0.0.1")
    expect(endpointToString(endpoint)).toBe("10.0.0.1")
    expect(l3EndpointToCidr(endpoint)).toBe("10.0.0.1/32")

    expect(network.l3EndpointEntity.schema.safeParse(endpoint).success).toBe(true)
  })

  it("parses hostname L3 endpoint", () => {
    const endpoint = parseEndpoint("example.com")

    expect(endpoint.level).toBe(3)
    expect(endpoint.type).toBe("hostname")
    expect(l3EndpointToString(endpoint)).toBe("example.com")

    expect(network.l3EndpointEntity.schema.safeParse(endpoint).success).toBe(true)
  })

  it("parses IPv6 L4 endpoint and formats with brackets", () => {
    const endpoint = parseEndpoint("[2001:db8::1]:6443", 4)

    expect(endpoint.level).toBe(4)
    expect(endpoint.type).toBe("ipv6")
    expect(endpoint.address?.value).toBe("2001:db8::1")
    expect(endpoint.port).toBe(6443)

    expect(l4EndpointToString(endpoint)).toBe("[2001:db8::1]:6443")
    expect(l4EndpointToFullString(endpoint)).toBe("tcp://[2001:db8::1]:6443")

    expect(network.l4EndpointEntity.schema.safeParse(endpoint).success).toBe(true)
  })

  it("parses L7 endpoint with app protocol", () => {
    const endpoint = parseEndpoint("https://10.0.0.2:8443/api", 7)

    expect(endpoint.level).toBe(7)
    expect(endpoint.type).toBe("ipv4")
    expect(endpoint.address?.value).toBe("10.0.0.2")
    expect(endpoint.port).toBe(8443)
    expect(endpoint.protocol).toBe("tcp")
    expect(endpoint.appProtocol).toBe("https")
    expect(endpoint.path).toBe("api")

    expect(l7EndpointToString(endpoint)).toBe("https://10.0.0.2:8443/api")

    expect(network.l7EndpointEntity.schema.safeParse(endpoint).success).toBe(true)
  })

  it("returns object endpoints as-is", () => {
    const endpoint: network.L3Endpoint = {
      level: 3,
      type: "ipv4",
      address: {
        type: "ipv4",
        value: "10.9.0.1",
        subnet: {
          type: "ipv4",
          baseAddress: "10.9.0.0",
          prefixLength: 24,
        },
      },
      metadata: {},
    }

    const parsed = parseEndpoint(endpoint)

    expect(parsed).toBe(endpoint)
    expect(parsed.type).toBe("ipv4")
    expect(parsed.subnet).toBeUndefined()
  })

  it("wraps network.Address input into L3 endpoint without reparsing", () => {
    const address = parseAddress("10.10.0.5/24")

    const endpoint = parseEndpoint(address)

    expect(endpoint.level).toBe(3)
    expect(endpoint.type).toBe("ipv4")
    expect(endpoint.address).toBe(address)
    expect(endpoint.subnet).toBe(address.subnet)
    expect(addressToCidr(endpoint.address!)).toBe("10.10.0.5/24")

    expect(network.l3EndpointEntity.schema.safeParse(endpoint).success).toBe(true)
  })

  describe("mergeEndpoints", () => {
    it("merges duplicates by string key and combines metadata", () => {
      const a = parseEndpoint("example.com")
      const b = parseEndpoint("example.com")

      const merged = mergeEndpoints([
        { ...a, metadata: { "test.one": "a" } },
        { ...b, metadata: { "test.two": 123 } },
      ])

      expect(merged).toHaveLength(1)
      expect(endpointToString(merged[0]!)).toBe("example.com")
      expect(merged[0]!.metadata).toMatchObject({
        "test.one": "a",
        "test.two": 123,
      })
    })

    it("lets later endpoints override metadata keys", () => {
      const a = parseEndpoint("example.com")
      const b = parseEndpoint("example.com")

      const merged = mergeEndpoints([
        { ...a, metadata: { "test.key": "first" } },
        { ...b, metadata: { "test.key": "second" } },
      ])

      expect(merged).toHaveLength(1)
      expect(merged[0]!.metadata).toMatchObject({ "test.key": "second" })
    })

    it("does not merge distinct endpoints", () => {
      const merged = mergeEndpoints([parseEndpoint("a.example"), parseEndpoint("b.example")])

      expect(merged).toHaveLength(2)
      expect(merged.map(endpointToString)).toEqual(["a.example", "b.example"])
    })

    it("handles missing metadata", () => {
      const a = parseEndpoint("example.com")
      const b = parseEndpoint("example.com")

      const merged = mergeEndpoints([a, { ...b, metadata: { "test.one": true } }])

      expect(merged).toHaveLength(1)
      expect(merged[0]!.metadata).toMatchObject({ "test.one": true })
    })
  })

  describe("replaceEndpointBase", () => {
    it("replaces IP base fields from an L3 IP base and keeps L7 properties", () => {
      const endpoint = parseEndpoint("https://10.0.0.2:8443/api", 7)
      const base = parseEndpoint("10.0.0.9")

      const replaced = rebaseEndpoint(endpoint, base)

      expect(replaced.level).toBe(7)
      expect(replaced.type).toBe("ipv4")
      expect(replaced.address?.value).toBe("10.0.0.9")
      expect(replaced.port).toBe(8443)
      expect(replaced.protocol).toBe("tcp")
      expect(replaced.appProtocol).toBe("https")
      expect(replaced.path).toBe("api")
      expect(replaced.metadata?.["iana.scope"]).toBe("private")
    })

    it("replaces hostname base from an L3 hostname base and keeps L7 properties", () => {
      const endpoint = parseEndpoint("https://example.com:8443/api", 7)
      const base = parseEndpoint("other.example")

      const replaced = rebaseEndpoint(endpoint, base)

      expect(replaced.level).toBe(7)
      expect(replaced.type).toBe("hostname")
      expect(replaced.hostname).toBe("other.example")
      expect(replaced.port).toBe(8443)
      expect(replaced.protocol).toBe("tcp")
      expect(replaced.appProtocol).toBe("https")
      expect(replaced.path).toBe("api")
    })

    it("converts hostname endpoint to IP endpoint when base is IP", () => {
      const endpoint = parseEndpoint("https://example.com:8443/api", 7)
      const base = parseEndpoint("10.0.0.9")

      const replaced = rebaseEndpoint(endpoint, base)

      expect(replaced.level).toBe(7)
      expect(replaced.type).toBe("ipv4")
      expect(replaced.address?.value).toBe("10.0.0.9")
      expect(replaced.port).toBe(8443)
      expect(replaced.metadata?.["iana.scope"]).toBe("private")
    })

    it("converts IPv4 endpoint to IPv6 endpoint when base is IPv6", () => {
      const endpoint = parseEndpoint("10.0.0.1:6443", 4)
      const base = parseEndpoint("2001:db8::2")

      const replaced = rebaseEndpoint(endpoint, base)

      expect(replaced.level).toBe(4)
      expect(replaced.type).toBe("ipv6")
      expect(replaced.address?.value).toBe("2001:db8::2")
      expect(replaced.port).toBe(6443)
      expect(replaced.protocol).toBe("tcp")
    })
  })
})
