import { describe, expect, it } from "vitest"
import { readAgentDocuments } from "./agent-docs"

describe("agent documents", () => {
  it("reads multiple documents in requested order", async () => {
    const result = await readAgentDocuments([
      "infrastructure-management",
      "infrastructure-design",
      "component-authoring",
    ])

    expect(result).toMatch(/^<!-- highstate-agent-doc: infrastructure-management -->/)

    expect(result.indexOf("# Infrastructure Management")).toBeLessThan(
      result.indexOf("# Infrastructure Design"),
    )

    expect(result.indexOf("# Infrastructure Design")).toBeLessThan(
      result.indexOf("# Component Authoring"),
    )
  })

  it("reports every unknown document and the available IDs", async () => {
    await expect(readAgentDocuments(["missing", "other"])).rejects.toThrow(
      'Unknown agent documents: "missing", "other". Available documents: component-authoring, infrastructure-design, infrastructure-management',
    )
  })
})
