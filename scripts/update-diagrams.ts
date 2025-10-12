import { promises as fs } from "node:fs"
import path from "node:path"

const BLOCK_PATTERN =
  /<!--\s*DEPENDENCY_GRAPH_START:\s*([^>]+?)\s*-->([\s\S]*?)<!--\s*DEPENDENCY_GRAPH_END\s*-->/g
const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const

type DependencyField = (typeof DEPENDENCY_FIELDS)[number]

type Manifest = {
  name?: string
  private?: boolean
} & Partial<Record<DependencyField, Record<string, string>>>

type BlockMatch = {
  label: string
  scopes: string[]
  start: number
  end: number
}

type PackageInfo = {
  name: string
  manifest: Manifest
  parentName?: string
}

type GraphNode = {
  name: string
  external: boolean
  group?: string
  isGroupParent?: boolean
}

const EXTERNAL_GROUP = "__external__"
const EXTERNAL_GROUP_LABEL = "Platform"

type Graph = {
  nodes: GraphNode[]
  edges: Array<[string, string]>
}

async function main(): Promise<void> {
  const repoRoot = process.cwd()
  const docRelativePath = path.join("contributing", "OVERVIEW.md")
  const docPath = path.join(repoRoot, docRelativePath)

  const original = await fs.readFile(docPath, "utf8")
  const blocks = extractBlocks(original)

  if (blocks.length === 0) {
    console.warn("No dependency graph blocks found.")
    return
  }

  const replacements = await Promise.all(
    blocks.map(async block => {
      const graph = await buildGraphForScopes(repoRoot, block.scopes)
      const blockContent = formatBlock(block.label, graph)
      return { ...block, content: blockContent }
    }),
  )

  let cursor = 0
  let updated = ""

  for (const block of replacements) {
    updated += original.slice(cursor, block.start)
    updated += block.content
    cursor = block.end
  }

  updated += original.slice(cursor)

  if (updated !== original) {
    await fs.writeFile(docPath, updated, "utf8")
  }
}

function extractBlocks(content: string): BlockMatch[] {
  const matches: BlockMatch[] = []
  let match: RegExpExecArray | null

  while ((match = BLOCK_PATTERN.exec(content)) !== null) {
    const label = match[1]?.trim()

    if (!label) {
      continue
    }

    matches.push({
      label,
      scopes: parseScopes(label),
      start: match.index,
      end: BLOCK_PATTERN.lastIndex,
    })
  }

  return matches
}

async function buildGraphForScopes(repoRoot: string, scopes: string[]): Promise<Graph> {
  const packages = new Map<string, PackageInfo>()
  const childrenByParent = new Map<string, Set<string>>()

  for (const scope of scopes) {
    const scopePath = path.join(repoRoot, scope)
    const scopePackages = await collectPackages(scopePath)

    for (const pkg of scopePackages) {
      packages.set(pkg.name, pkg)

      if (pkg.parentName) {
        const children = childrenByParent.get(pkg.parentName) ?? new Set<string>()
        children.add(pkg.name)
        childrenByParent.set(pkg.parentName, children)
      }
    }
  }

  for (const parent of Array.from(childrenByParent.keys())) {
    if (!packages.has(parent)) {
      childrenByParent.delete(parent)
    }
  }

  const adjacency = new Map<string, Set<string>>()
  const nodeMeta = new Map<string, GraphNode>()

  for (const pkg of packages.values()) {
    const children = childrenByParent.get(pkg.name)
    const isGroupParent = !!(children && children.size > 0)
    const parentName = pkg.parentName

    const meta: GraphNode = {
      name: pkg.name,
      external: false,
      group: undefined,
      isGroupParent,
    }

    if (isGroupParent) {
      meta.group = pkg.name
    } else if (parentName && packages.has(parentName)) {
      meta.group = parentName
    }

    adjacency.set(pkg.name, new Set())
    nodeMeta.set(pkg.name, meta)
  }

  for (const pkg of packages.values()) {
    const manifest = pkg.manifest
    const targets = adjacency.get(pkg.name)

    if (!targets) {
      continue
    }

    for (const field of DEPENDENCY_FIELDS) {
      const fieldDeps = manifest[field]

      if (!fieldDeps) {
        continue
      }

      for (const depName of Object.keys(fieldDeps)) {
        if (depName === pkg.name || isExample(depName)) {
          continue
        }

        if (!adjacency.has(depName)) {
          if (!shouldIncludeExternal(depName)) {
            continue
          }

          adjacency.set(depName, new Set())
          nodeMeta.set(depName, {
            name: depName,
            external: true,
            group: EXTERNAL_GROUP,
            isGroupParent: false,
          })
        }

        targets.add(depName)
      }
    }
  }

  const reduced = reduceEdges(adjacency)
  const edges: Array<[string, string]> = []

  for (const [source, targets] of reduced) {
    for (const target of targets) {
      edges.push([source, target])
    }
  }

  edges.sort((a, b) => {
    if (a[0] === b[0]) {
      return a[1].localeCompare(b[1])
    }

    return a[0].localeCompare(b[0])
  })

  const nodes = Array.from(nodeMeta.values()).sort((a, b) => a.name.localeCompare(b.name))

  return { nodes, edges }
}

async function collectPackages(scopePath: string): Promise<PackageInfo[]> {
  let dirents: import("node:fs").Dirent[]

  try {
    dirents = await fs.readdir(scopePath, { withFileTypes: true })
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === "ENOENT") {
      console.warn(`Scope "${scopePath}" does not exist.`)
      return []
    }

    throw error
  }

  const packages: PackageInfo[] = []

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) {
      continue
    }

    const name = dirent.name

    if (name === "node_modules" || name.startsWith(".")) {
      continue
    }

    const packageDir = path.join(scopePath, name)
    const collected = await collectPackagesFromDirectory(packageDir)
    packages.push(...collected)
  }

  return packages
}

async function collectPackagesFromDirectory(directory: string): Promise<PackageInfo[]> {
  const packages: PackageInfo[] = []
  const packageJsonPath = path.join(directory, "package.json")
  let manifest: Manifest | undefined

  try {
    const raw = await fs.readFile(packageJsonPath, "utf8")
    manifest = JSON.parse(raw) as Manifest
  } catch {
    manifest = undefined
  }

  let parentName: string | undefined

  if (manifest?.name && !isExample(manifest.name)) {
    packages.push({ name: manifest.name, manifest, parentName: undefined })
    parentName = manifest.name
  }

  const generatedDir = path.join(directory, "generated")
  let generatedEntries: import("node:fs").Dirent[] = []

  try {
    generatedEntries = await fs.readdir(generatedDir, { withFileTypes: true })
  } catch {
    generatedEntries = []
  }

  for (const dirent of generatedEntries) {
    if (!dirent.isDirectory()) {
      continue
    }

    const childName = dirent.name

    if (childName === "node_modules" || childName.startsWith(".")) {
      continue
    }

    const childDir = path.join(generatedDir, childName)
    const childPackageJson = path.join(childDir, "package.json")
    let childManifest: Manifest | undefined

    try {
      const raw = await fs.readFile(childPackageJson, "utf8")
      childManifest = JSON.parse(raw) as Manifest
    } catch {
      continue
    }

    if (!childManifest.name || isExample(childManifest.name)) {
      continue
    }

    packages.push({ name: childManifest.name, manifest: childManifest, parentName })
  }

  return packages
}

function parseScopes(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map(scope => scope.trim())
    .filter(Boolean)
}

function isExample(name: string): boolean {
  return /^(@highstate\/)?example(\.|$)/.test(name)
}

function shouldIncludeExternal(name: string): boolean {
  return name.startsWith("@highstate/")
}

function reduceEdges(graph: Map<string, Set<string>>): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()

  for (const [source, targets] of graph) {
    const kept = new Set<string>()

    for (const target of targets) {
      if (!hasAlternatePath(source, target, graph)) {
        kept.add(target)
      }
    }

    result.set(source, kept)
  }

  return result
}

function hasAlternatePath(
  source: string,
  target: string,
  graph: Map<string, Set<string>>,
): boolean {
  const visited = new Set<string>([source])
  const queue: string[] = []

  const directNeighbors = graph.get(source)

  if (directNeighbors) {
    for (const neighbor of directNeighbors) {
      if (neighbor === target) {
        continue
      }

      if (!visited.has(neighbor)) {
        visited.add(neighbor)
        queue.push(neighbor)
      }
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!

    if (current === target) {
      return true
    }

    const neighbors = graph.get(current)

    if (!neighbors) {
      continue
    }

    for (const neighbor of neighbors) {
      if (neighbor === target) {
        return true
      }

      if (!visited.has(neighbor)) {
        visited.add(neighbor)
        queue.push(neighbor)
      }
    }
  }

  return false
}

function formatBlock(label: string, graph: Graph): string {
  const idMap = buildIdMap(graph.nodes.map(node => node.name))
  const lines: string[] = ["graph LR"]
  const nodeLines: string[] = []
  const edgeLines: string[] = []

  const groups = new Map<string, { nodes: GraphNode[]; label: string; force: boolean }>()

  for (const node of graph.nodes) {
    if (!node.group) {
      continue
    }

    const entry = groups.get(node.group) ?? {
      nodes: [],
      label: node.group === EXTERNAL_GROUP ? EXTERNAL_GROUP_LABEL : node.group,
      force: node.group === EXTERNAL_GROUP,
    }

    entry.nodes.push(node)
    groups.set(node.group, entry)
  }

  const groupedNodes = new Set<string>()
  const sortedGroups = Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label))

  for (const group of sortedGroups) {
    const shouldRender = group.force || group.nodes.length > 1

    if (!shouldRender) {
      continue
    }

    nodeLines.push(`  subgraph "${escapeLabel(group.label)}"`)

    const ordered = group.nodes.slice().sort((a, b) => {
      if (!!a.isGroupParent === !!b.isGroupParent) {
        return a.name.localeCompare(b.name)
      }

      return a.isGroupParent ? -1 : 1
    })

    for (const node of ordered) {
      const id = idMap.get(node.name)!
      const display = `**${node.name}**`
      nodeLines.push(`    ${id}["${escapeLabel(display)}"]`)
      groupedNodes.add(node.name)
    }

    nodeLines.push("  end")
  }

  for (const node of graph.nodes) {
    if (groupedNodes.has(node.name)) {
      continue
    }

    const id = idMap.get(node.name)!
    const display = `**${node.name}**`
    nodeLines.push(`  ${id}["${escapeLabel(display)}"]`)
  }

  for (const [source, target] of graph.edges) {
    const srcId = idMap.get(source)!
    const targetId = idMap.get(target)!
    edgeLines.push(`  ${srcId} --> ${targetId}`)
  }

  lines.push(...nodeLines, ...edgeLines)

  const blockLines = [
    `<!-- DEPENDENCY_GRAPH_START: ${label} -->`,
    "",
    "```mermaid",
    ...lines,
    "```",
    "",
    "<!-- DEPENDENCY_GRAPH_END -->",
  ]

  return blockLines.join("\n")
}

function buildIdMap(names: string[]): Map<string, string> {
  const map = new Map<string, string>()
  const used = new Set<string>()

  for (const name of names) {
    const base = `pkg_${name.replace(/[^a-zA-Z0-9]/g, "_")}`
    let candidate = base
    let counter = 1

    while (used.has(candidate)) {
      candidate = `${base}_${counter++}`
    }

    used.add(candidate)
    map.set(name, candidate)
  }

  return map
}

function escapeLabel(label: string): string {
  return label.replace(/"/g, '\\"')
}

await main()
