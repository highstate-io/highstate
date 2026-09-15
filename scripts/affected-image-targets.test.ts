import { describe, expect, test } from "vitest"
import { selectAffectedImageTargets } from "./affected-image-targets"

describe("selectAffectedImageTargets", () => {
  test("ignores changes unrelated to images", () => {
    expect(
      selectAffectedImageTargets(
        ["packages/platform/designer/app.vue"],
        new Set(["@highstate/designer"]),
      ),
    ).toEqual([])
  })

  test("includes targets that inherit from a changed terminal image", () => {
    expect(
      selectAffectedImageTargets(["docker/terminal.kubectl.dockerfile"], new Set()),
    ).toEqual(["terminal-kubectl", "terminal-talosctl"])
  })

  test("includes images for affected worker projects", () => {
    expect(
      selectAffectedImageTargets(
        [],
        new Set(["@highstate/k8s.monitor-worker", "@highstate/k8s.dashboard-worker"]),
      ),
    ).toEqual(["worker-k8s-monitor", "worker-k8s-dashboard"])
  })

  test("includes all images when shared bake configuration changes", () => {
    expect(selectAffectedImageTargets(["docker/docker-bake.hcl"], new Set())).toEqual([
      "terminal-base",
      "terminal-kubectl",
      "terminal-restic",
      "terminal-ssh",
      "terminal-talosctl",
      "worker-k8s-monitor",
      "worker-k8s-dashboard",
    ])
  })
})
