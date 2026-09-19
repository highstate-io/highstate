import { describe, expect, it } from "vitest"
import { humanDetails, humanTable } from "./remote-io"

describe("remote human output", () => {
  it("renders aligned tables with headers", () => {
    expect(
      humanTable(
        ["NAME", "STATUS"],
        [
          ["short", "ready"],
          ["long-name", undefined],
        ],
        "No resources",
      ),
    ).toBe("NAME       STATUS\nshort      ready\nlong-name  <none>")
  })

  it("renders nested resource details", () => {
    expect(
      humanDetails({
        model: {
          id: "component:type",
          kind: "COMPONENT_KIND_UNIT",
          description: "First line\nSecond line",
          arguments: [{ key: "fqdn", value: "example.com" }],
          position: {},
          children: [],
        },
      }),
    ).toBe(
      "Model:\n  ID: component:type\n  Kind: UNIT\n  Description:\n    First line\n    Second line\n  Arguments:\n    - Key: fqdn\n      Value: example.com",
    )
  })
})
