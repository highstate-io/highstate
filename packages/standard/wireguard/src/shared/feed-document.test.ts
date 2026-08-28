import { parseEndpoint } from "@highstate/common"
import { describe, expect, it } from "vitest"
import { createFeedDocument, createFeedTunnel } from "./feed-document"

describe("feed document", () => {
  it("maps config metadata into a tunnel", () => {
    const tunnel = createFeedTunnel(
      {
        id: "malmo",
        name: "malmo",
        enabled: true,
        forced: false,
        exclusive: true,
        warningMessage: "warning",
        displayInfo: {
          title: "Malmo",
          description: "Sweden",
          iconUrl: "https://example.com/se.svg",
        },
      },
      "[Interface]",
    )

    expect(tunnel).toEqual({
      id: "malmo",
      name: "malmo",
      enabled: true,
      forced: false,
      exclusive: true,
      warning_message: "warning",
      display_info: {
        title: "Malmo",
        description: "Sweden",
        icon_url: "https://example.com/se.svg",
      },
      wg_quick_config: "[Interface]",
    })
  })

  it("creates stable feed metadata and subscription endpoints", () => {
    const document = createFeedDocument({
      feedId: "feed-id",
      displayInfo: { title: "VPN" },
      serverEndpoints: [parseEndpoint("feed.example.com:443", 4)],
      tunnels: [],
    })

    expect(document.id).toBe("9764ce01-4174-5373-9557-b8da6b42ff62")
    expect(document.endpoints).toEqual(["https://feed.example.com/feed-id"])
  })
})
