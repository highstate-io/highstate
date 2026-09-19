import { describe, expect, it } from "vitest"
import { agentDocuments, readAgentDocuments } from "./agent-docs"

describe("agent documents", () => {
  it("exposes task-oriented document metadata", () => {
    expect(agentDocuments.map(document => document.id)).toEqual([
      "component-authoring",
      "infrastructure-management",
    ])
  })

  it("reads multiple documents in requested order", async () => {
    const result = await readAgentDocuments(["infrastructure-management", "component-authoring"])

    expect(result).toMatch(/^<!-- highstate-agent-doc: infrastructure-management -->/)
    expect(result.indexOf("# Infrastructure Management")).toBeLessThan(
      result.indexOf("# Component Authoring"),
    )
  })

  it("reports every unknown document and the available IDs", async () => {
    await expect(readAgentDocuments(["missing", "other"])).rejects.toThrow(
      'Unknown agent documents: "missing", "other". Available documents: component-authoring, infrastructure-management',
    )
  })
})
