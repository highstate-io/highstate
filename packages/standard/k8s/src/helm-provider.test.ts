import type { k8s } from "@highstate/library"
import type { helm } from "@pulumi/kubernetes"
import type { ComponentResourceOptions, ResourceTransform } from "@pulumi/pulumi"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeFile, toPromise } from "@highstate/pulumi"
import { runtime } from "@pulumi/pulumi"
import { afterEach, expect, it, vi } from "vitest"
import { Chart } from "./helm"
import { Namespace } from "./namespace"
import { getProvider } from "./shared"

const capture = vi.hoisted(() => ({ transforms: [] as ResourceTransform[] }))

// The mock monitor does not implement transform callbacks; provider inheritance
// still runs through the real remote Helm resource and Pulumi registration path.
vi.mock("@pulumi/kubernetes", async importOriginal => {
  const original = await importOriginal<typeof import("@pulumi/kubernetes")>()
  class MockMonitorChart extends original.helm.v4.Chart {
    constructor(name: string, args: helm.v4.ChartArgs, opts?: ComponentResourceOptions) {
      const { transforms: _transforms, ...supported } = opts ?? {}
      capture.transforms = _transforms ?? []
      super(name, args, supported)
    }
  }
  return {
    ...original,
    helm: { ...original.helm, v4: { ...original.helm.v4, Chart: MockMonitorChart } },
  }
})

const directories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

runtime.setMocks(
  {
    newResource: args => {
      return {
        id: args.name,
        state: {
          ...args.inputs,
          resources: [],
          metadata: { ...args.inputs.metadata, uid: args.name },
          status: {},
        },
      }
    },
    call: args => args.inputs,
  },
  "chart-provider-test",
  "test",
)

it("keeps chart children on the namespace cluster even without remote provider inheritance", async () => {
  const cache = await mkdtemp(join(tmpdir(), "highstate-helm-provider-"))
  directories.push(cache)
  await mkdir(join(cache, "charts"))
  await writeFile(join(cache, "charts/mock-1.tgz"), "mocked chart")
  vi.stubEnv("HIGHSTATE_CACHE_DIR", cache)

  const cluster = {
    name: "scoped",
    id: "scoped",
    connectionId: "scoped",
    kubeconfig: makeFile({ name: "kubeconfig", content: "mock", isSecret: true }),
  } as k8s.Cluster

  const namespace = Namespace.fromEntity(
    {
      $meta: { type: "k8s.namespace.v1", identity: "scoped" },
      clusterId: cluster.id,
      clusterName: cluster.name,
      apiVersion: "v1",
      kind: "Namespace",
      isNamespaced: false,
      metadata: { name: "scoped", uid: "scoped" },
    } as k8s.Namespace,
    cluster,
  )

  const chart = new Chart("scoped-chart", {
    namespace,
    chart: {
      name: "mock",
      version: "1",
      repo: "https://example.invalid",
      sha256: "unused cached mock",
    },
  })

  const remote = await toPromise(chart.chart)
  await toPromise(remote.urn)
  const provider = getProvider(cluster)
  const transform = capture.transforms.at(-1)
  expect(transform).toBeDefined()
  const props = { metadata: { name: "config", namespace: "scoped" } }

  const result = await transform!({
    type: "kubernetes:core/v1:ConfigMap",
    name: "scoped-chart:scoped/config",
    custom: true,
    props,
    opts: { protect: true },
  })

  expect(result?.opts.provider).toBe(provider)
  expect(result?.opts.protect).toBe(true)
  expect(result?.props).toEqual(props)
})
