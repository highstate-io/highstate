import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { resolvePackageAsset } from "./package-assets"

export const agentDocuments = [
  {
    id: "component-authoring",
    title: "Component Authoring",
    description: "Design and implement Highstate entities, units, composites, and Pulumi programs.",
  },
  {
    id: "infrastructure-management",
    title: "Infrastructure Management",
    description: "Research and safely update Highstate projects through the CLI.",
  },
] as const

export type AgentDocumentId = (typeof agentDocuments)[number]["id"]

export function isAgentDocumentId(value: string): value is AgentDocumentId {
  return agentDocuments.some(document => document.id === value)
}

export async function readAgentDocuments(
  ids: readonly string[],
  moduleUrl = import.meta.url,
): Promise<string> {
  const unknownIds = ids.filter(id => !isAgentDocumentId(id))
  if (unknownIds.length > 0) {
    throw new Error(
      `Unknown agent document${unknownIds.length === 1 ? "" : "s"}: ${unknownIds.map(id => `"${id}"`).join(", ")}. Available documents: ${agentDocuments.map(document => document.id).join(", ")}`,
    )
  }

  const directory = await resolvePackageAsset(moduleUrl, "@highstate/cli", "assets", "agent-docs")
  const documents = await Promise.all(
    ids.map(async id => ({
      id,
      content: (await readFile(join(directory, `${id}.md`), "utf8")).trim(),
    })),
  )

  return documents
    .map(document => `<!-- highstate-agent-doc: ${document.id} -->\n\n${document.content}`)
    .join("\n\n---\n\n")
}
