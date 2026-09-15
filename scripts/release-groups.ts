import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

export type ProjectManifest = {
  name?: string
  highstate?: Record<string, unknown>
  [key: string]: unknown
}

type NxConfiguration = {
  release?: { groups?: Record<string, { projects?: string[] }> }
}

type NxProjectGraph = {
  graph: {
    nodes: Record<
      string,
      {
        data: {
          tags?: string[]
          metadata?: { js?: { packageName?: string } }
        }
      }
    >
  }
}

type ChangesetsConfiguration = {
  fixed?: string[][]
  [key: string]: unknown
}

export const RELEASE_GROUP_ANCHORS = {
  platform: "packages/platform/contract/package.json",
  stdlib: "packages/standard/library/package.json",
} as const

const CHANGESETS_CONFIGURATION = ".changeset/config.json"

export function collectReleaseGroupPackages(
  configuration: NxConfiguration,
  graph: NxProjectGraph,
  group: string,
): string[] {
  const selectors = configuration.release?.groups?.[group]?.projects
  if (!selectors?.length) {
    throw new Error(`Nx release group "${group}" does not define any projects`)
  }

  const tags = selectors.map(selector => {
    if (!selector.startsWith("tag:")) {
      throw new Error(`Unsupported Nx release group selector "${selector}"`)
    }

    return selector.slice("tag:".length)
  })

  return Object.values(graph.graph.nodes)
    .filter(project => project.data.tags?.includes("npm:public"))
    .filter(project => tags.some(tag => project.data.tags?.includes(tag)))
    .map(project => project.data.metadata?.js?.packageName)
    .filter((name): name is string => Boolean(name))
    .sort()
}

export function withReleaseGroup(
  manifest: ProjectManifest,
  group: string,
  packages: string[],
): ProjectManifest {
  return {
    ...manifest,
    highstate: {
      ...manifest.highstate,
      release: { group, packages },
    },
  }
}

export function withFixedReleaseGroups(
  configuration: ChangesetsConfiguration,
  releaseGroups: string[][],
): ChangesetsConfiguration {
  return { ...configuration, fixed: releaseGroups }
}

export async function synchronizeReleaseGroups(root: string, check: boolean): Promise<void> {
  const configuration = JSON.parse(await readFile(resolve(root, "nx.json"), "utf8")) as NxConfiguration
  const nx = Bun.spawn(["bun", "nx", "graph", "--file=stdout"], {
    cwd: root,
    stdout: "pipe",
    stderr: "inherit",
  })
  const graphOutput = await new Response(nx.stdout).text()
  if ((await nx.exited) !== 0) {
    throw new Error("Unable to read the Nx project graph")
  }
  const graph = JSON.parse(graphOutput) as NxProjectGraph

  const stale: string[] = []
  const releaseGroups: string[][] = []
  for (const [group, relativePath] of Object.entries(RELEASE_GROUP_ANCHORS)) {
    const path = resolve(root, relativePath)
    const source = await readFile(path, "utf8")
    const manifest = JSON.parse(source) as ProjectManifest
    const packages = collectReleaseGroupPackages(configuration, graph, group)
    releaseGroups.push(packages)
    if (!manifest.name || !packages.includes(manifest.name)) {
      throw new Error(`Release group anchor "${relativePath}" does not belong to group "${group}"`)
    }

    const updated = `${JSON.stringify(withReleaseGroup(manifest, group, packages), null, 2)}\n`

    if (source === updated) {
      continue
    }
    if (check) {
      stale.push(relativePath)
    } else {
      await writeFile(path, updated)
    }
  }

  const changesetsPath = resolve(root, CHANGESETS_CONFIGURATION)
  const changesetsSource = await readFile(changesetsPath, "utf8")
  const changesetsConfiguration = JSON.parse(changesetsSource) as ChangesetsConfiguration
  const updatedChangesets = `${JSON.stringify(
    withFixedReleaseGroups(changesetsConfiguration, releaseGroups),
    null,
    2,
  )}\n`
  if (changesetsSource !== updatedChangesets) {
    if (check) {
      stale.push(CHANGESETS_CONFIGURATION)
    } else {
      await writeFile(changesetsPath, updatedChangesets)
    }
  }

  if (stale.length > 0) {
    throw new Error(`Release group metadata is stale in: ${stale.join(", ")}`)
  }
}

if (import.meta.main) {
  await synchronizeReleaseGroups(resolve(import.meta.dirname, ".."), process.argv.includes("--check"))
}
