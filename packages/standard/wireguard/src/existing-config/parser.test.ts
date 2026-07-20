import { describe, expect, it } from "vitest"
import { parseExistingConfig } from "./parser"

describe("parseExistingConfig", () => {
  it("parses interface and peer sections", () => {
    const parsed = parseExistingConfig(`
      [Interface]
      # laptop
      PrivateKey = private-key
      Address = 10.0.0.2/32, fd00::2/128
      DNS = 1.1.1.1, 2606:4700:4700::1111
      ListenPort = 51821

      [Peer]
      # exit
      PublicKey = peer-public-key
      PresharedKey = peer-preshared-key
      AllowedIPs = 0.0.0.0/0, ::/0
      Endpoint = vpn.example.com:51820
      PersistentKeepalive = 25
    `)

    expect(parsed).toEqual({
      interface: {
        name: "laptop",
        privateKey: "private-key",
        addresses: ["10.0.0.2/32", "fd00::2/128"],
        dns: ["1.1.1.1", "2606:4700:4700::1111"],
        listenPort: 51821,
        amnezia: {},
      },
      peers: [
        {
          name: "exit",
          publicKey: "peer-public-key",
          presharedKey: "peer-preshared-key",
          allowedIps: ["0.0.0.0/0", "::/0"],
          endpoint: "vpn.example.com:51820",
          persistentKeepalive: 25,
        },
      ],
    })
  })

  it("extracts AmneziaWG interface fields", () => {
    const parsed = parseExistingConfig(`
      [Interface]
      PrivateKey = private-key
      Address = 10.0.0.2/32
      Jc = 4
      Jmin = 40
      Jmax = 70
      S1 = 11
      S2 = 22
      H1 = 1a2b3c4d
      I1 = 5a6b7c8d
    `)

    expect(parsed.interface.amnezia).toEqual({
      jc: 4,
      jmin: 40,
      jmax: 70,
      s1: 11,
      s2: 22,
      h1: "1a2b3c4d",
      i1: "5a6b7c8d",
    })
  })

  it("uses comments before sections as names", () => {
    const parsed = parseExistingConfig(`
      # phone
      [Interface]
      PrivateKey = private-key

      ; relay
      [Peer]
      PublicKey = peer-public-key
    `)

    expect(parsed.interface.name).toBe("phone")
    expect(parsed.peers[0]?.name).toBe("relay")
  })

  it("defaults optional numeric fields", () => {
    const parsed = parseExistingConfig(`
      [Interface]
      PrivateKey = private-key

      [Peer]
      PublicKey = peer-public-key
    `)

    expect(parsed.interface.listenPort).toBe(51820)
    expect(parsed.peers[0]?.persistentKeepalive).toBe(0)
  })

  it("throws when interface section is missing", () => {
    expect(() =>
      parseExistingConfig(`
        [Peer]
        PublicKey = peer-public-key
      `),
    ).toThrow(/\[Interface]/)
  })

  it("throws when AmneziaWG numeric fields are invalid", () => {
    expect(() =>
      parseExistingConfig(`
        [Interface]
        PrivateKey = private-key
        Jc = invalid
      `),
    ).toThrow(/jc.*integer/)
  })
})
