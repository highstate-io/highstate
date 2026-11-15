import { describe, expect, test } from "vitest"
import { selectAffectedImageTargets } from "./affected-image-targets"

describe("selectAffectedImageTargets", () => {
  test("ignores changes unrelated to images", () => {
    expect(
      selectAffectedImageTargets(
        ["packages/platform/docs/content/index.md"],
        new Set(["@highstate/docs"]),
      ),
    ).toEqual([])
  })

  test("includes targets that inherit from a changed terminal image", () => {
    expect(
      selectAffectedImageTargets(["docker/core/terminal.kubectl.dockerfile"], new Set()),
    ).toEqual(["core-terminal-kubectl", "core-terminal-talosctl"])
  })

  test("includes images for affected worker projects", () => {
    expect(
      selectAffectedImageTargets(
        [],
        new Set(["@highstate/k8s.monitor-worker", "@highstate/k8s.dashboard-worker"]),
      ),
    ).toEqual(["core-worker-k8s-monitor", "core-worker-k8s-dashboard"])
  })

  test("includes all images when shared bake configuration changes", () => {
    expect(selectAffectedImageTargets(["docker/docker-bake.hcl"], new Set())).toEqual([
      "core-terminal-base",
      "core-terminal-kubectl",
      "core-terminal-restic",
      "core-terminal-ssh",
      "core-terminal-talosctl",
      "core-worker-k8s-monitor",
      "core-worker-k8s-dashboard",
      "apps-exetrouter",
      "highstate",
    ])
  })

  test("rebuilds exetrouter when its runtime scripts change", () => {
    expect(selectAffectedImageTargets(["docker/apps/exetrouter/entrypoint.sh"], new Set())).toEqual(
      ["apps-exetrouter"],
    )
  })

  test("rebuilds a worker when its core dockerfile changes", () => {
    expect(
      selectAffectedImageTargets(["docker/core/worker.k8s-monitor.dockerfile"], new Set()),
    ).toEqual(["core-worker-k8s-monitor"])
  })

  test("rebuilds Highstate for Designer and dependency changes", () => {
    expect(selectAffectedImageTargets([], new Set(["@highstate/designer"]))).toEqual(["highstate"])
  })

  test("rebuilds Highstate when its image inputs change", () => {
    for (const path of [
      "docker/highstate.dockerfile",
      "docker/highstate-entrypoint.sh",
      ".dockerignore",
    ]) {
      expect(selectAffectedImageTargets([path], new Set())).toEqual(["highstate"])
    }
  })
})
