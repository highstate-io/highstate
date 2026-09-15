#!/usr/bin/env bun
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const terminalTargets = [
  "terminal-base",
  "terminal-kubectl",
  "terminal-restic",
  "terminal-ssh",
  "terminal-talosctl",
] as const
const workerTargets = ["worker-k8s-monitor", "worker-k8s-dashboard"] as const
const allTargets = [...terminalTargets, ...workerTargets]

const terminalDependents: Record<string, string[]> = {
  "terminal-base": [...terminalTargets],
  "terminal-kubectl": ["terminal-kubectl", "terminal-talosctl"],
  "terminal-restic": ["terminal-restic"],
  "terminal-ssh": ["terminal-ssh"],
  "terminal-talosctl": ["terminal-talosctl"],
}

export function selectAffectedImageTargets(
  changedFiles: readonly string[],
  affectedProjects: ReadonlySet<string>,
): string[] {
  const targets = new Set<string>()

  for (const path of changedFiles) {
    if (path === "docker/docker-bake.hcl" || path === "docker/project.json") {
      allTargets.forEach(target => targets.add(target))
      continue
    }

    const match = path.match(/^docker\/(terminal\.[^.]+)\.dockerfile$/)
    if (!match) {
      continue
    }

    const target = match[1].replaceAll(".", "-")
    terminalDependents[target]?.forEach(dependent => targets.add(dependent))
  }

  if (affectedProjects.has("@highstate/k8s.monitor-worker")) {
    targets.add("worker-k8s-monitor")
  }
  if (affectedProjects.has("@highstate/k8s.dashboard-worker")) {
    targets.add("worker-k8s-dashboard")
  }

  return [
    ...terminalTargets.filter(target => targets.has(target)),
    ...workerTargets.filter(target => targets.has(target)),
  ]
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
