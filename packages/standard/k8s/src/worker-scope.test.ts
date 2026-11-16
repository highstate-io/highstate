import type { k8s } from "@highstate/library"
import { makeFile, toPromise } from "@highstate/pulumi"
import { runtime } from "@pulumi/pulumi"
import { expect, it } from "vitest"
import { Namespace } from "./namespace"
import { Service } from "./service"
import { createMonitorWorker } from "./worker"

const resources: runtime.MockResourceArgs[] = []

runtime.setMocks(
  {
    newResource: args => {
      resources.push(args)
      return {
        id: args.name,
        state: {
          ...args.inputs,
          metadata: { ...args.inputs.metadata, uid: args.name },
          spec: { ...args.inputs.spec, clusterIP: "10.0.0.1", clusterIPs: [], externalIPs: [] },
          status: { loadBalancer: { ingress: [] } },
          data: { ...args.inputs.data, token: Buffer.from("scoped-token").toString("base64") },
        },
      }
    },
    call: args => args.inputs,
  },
  "worker-scope-test",
  "test",
)

it("creates distinct namespace-local monitor identities for apps sharing a namespace", async () => {
  const kubeconfig = JSON.stringify({
    apiVersion: "v1",
    kind: "Config",
    "current-context": "test",
    clusters: [{ name: "test", cluster: { server: "https://127.0.0.1:6443" } }],
    users: [{ name: "test", user: { token: "original-token" } }],
    contexts: [{ name: "test", context: { cluster: "test", user: "test" } }],
  })

  const cluster = {
    id: "shared",
    name: "shared",
    connectionId: "shared",
    kubeconfig: makeFile({ name: "kubeconfig", content: kubeconfig, isSecret: true }),
  } as k8s.Cluster

  const namespace = Namespace.fromEntity(
    {
      $meta: { type: "k8s.namespace.v1", identity: "shared" },
      clusterId: cluster.id,
      clusterName: cluster.name,
      apiVersion: "v1",
      kind: "Namespace",
      isNamespaced: false,
      metadata: { name: "shared", uid: "shared" },
    } as k8s.Namespace,
    cluster,
  )

  for (const name of ["app-a", "app-b"]) {
    const service = Service.create(name, { namespace, ports: [{ port: 80 }] })
    await toPromise(await createMonitorWorker(namespace, [service]))
  }

  expect(
    resources.some(
      resource => resource.type === "kubernetes:rbac.authorization.k8s.io/v1:ClusterRole",
    ),
  ).toBe(false)

  const roles = resources.filter(
    resource => resource.type === "kubernetes:rbac.authorization.k8s.io/v1:Role",
  )

  expect(roles.map(role => role.inputs.metadata.name).sort()).toEqual([
    "app-a-monitor",
    "app-b-monitor",
  ])

  expect(roles.every(role => role.inputs.metadata.namespace === "shared")).toBe(true)

  const bindings = resources.filter(
    resource => resource.type === "kubernetes:rbac.authorization.k8s.io/v1:RoleBinding",
  )

  expect(bindings).toHaveLength(2)
  expect(bindings.every(binding => binding.inputs.roleRef.kind === "Role")).toBe(true)

  expect(
    roles.every(role =>
      role.inputs.rules.every((rule: { apiGroups: string[] }) => rule.apiGroups.length === 1),
    ),
  ).toBe(true)
})
