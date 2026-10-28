#!/usr/bin/env bun
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const terminalTargets = [
  "core-terminal-base",
  "core-terminal-kubectl",
  "core-terminal-restic",
  "core-terminal-ssh",
  "core-terminal-talosctl",
] as const
const workerTargets = ["core-worker-k8s-monitor", "core-worker-k8s-dashboard"] as const
const allTargets = [...terminalTargets, ...workerTargets, "apps-exetrouter"]

const terminalDependents: Record<string, string[]> = {
  "core-terminal-base": [...terminalTargets],
  "core-terminal-kubectl": ["core-terminal-kubectl", "core-terminal-talosctl"],
  "core-terminal-restic": ["core-terminal-restic"],
  "core-terminal-ssh": ["core-terminal-ssh"],
  "core-terminal-talosctl": ["core-terminal-talosctl"],
}

export function selectAffectedImageTargets(
  changedFiles: readonly string[],
  affectedProjects: ReadonlySet<string>,
): string[] {
  const targets = new Set<string>()

  for (const path of changedFiles) {
    if (path.startsWith("docker/apps/exetrouter/")) {
      targets.add("apps-exetrouter")
    }

    if (path === "docker/docker-bake.hcl" || path === "docker/project.json") {
      allTargets.forEach(target => {
        targets.add(target)
      })

      continue
    }

    const worker = path.match(/^docker\/core\/(worker\.k8s-(?:monitor|dashboard))\.dockerfile$/)
    if (worker) {
      targets.add(`core-${worker[1].replaceAll(".", "-")}`)
    }

    const match = path.match(/^docker\/core\/(terminal\.[^.]+)\.dockerfile$/)
    if (!match) {
      continue
    }

    const target = `core-${match[1].replaceAll(".", "-")}`

    terminalDependents[target]?.forEach(dependent => {
      targets.add(dependent)
    })
  }

  if (affectedProjects.has("@highstate/k8s.monitor-worker")) {
    targets.add("core-worker-k8s-monitor")
  }

  if (affectedProjects.has("@highstate/k8s.dashboard-worker")) {
    targets.add("core-worker-k8s-dashboard")
  }

  return allTargets.filter(target => targets.has(target))
}

async function commandOutput(command: string[], cwd: string): Promise<string> {
  const process = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "inherit" })
  const output = await new Response(process.stdout).text()

  if ((await process.exited) !== 0) {
    throw new Error(`Command failed: ${command.join(" ")}`)
  }

  return output
}

if (import.meta.main) {
  const value = (name: string): string => {
    const index = process.argv.indexOf(name)
    const result = index === -1 ? undefined : process.argv[index + 1]
    if (!result) {
      throw new Error(`Missing ${name}`)
    }

    return result
  }

  const rootIndex = process.argv.indexOf("--root")
  const root = resolve(rootIndex === -1 ? "." : process.argv[rootIndex + 1])
  const base = value("--base")
  const head = value("--head")
  const output = value("--output")

  const changedFiles = (await commandOutput(["git", "diff", "--name-only", base, head], root))
    .trim()
    .split("\n")
    .filter(Boolean)

  const projects = JSON.parse(
    await commandOutput(
      ["bun", "nx", "show", "projects", "--affected", `--base=${base}`, `--head=${head}`, "--json"],
      root,
    ),
  ) as string[]

  const targets = selectAffectedImageTargets(changedFiles, new Set(projects))

  await writeFile(output, `${JSON.stringify({ targets }, null, 2)}\n`)
  console.log(targets.join(" "))
}
