import { common, k3s, k8s } from "@highstate/library"

const { server: master } = common.existingServer({
  name: "master",
  args: {
    endpoint: "192.168.1.10",
  },
})

const { k8sCluster } = k3s.cluster({
  name: "my-cluster",
  inputs: {
    masters: [master],
  },
})

k8s.apps.traefik({
  name: "traefik",
  args: {
    external: true,
    enableGatewayApi: true,
    values: {
      deployment: {
        replicas: 1,
        podAnnotations: {
          "example.com/managed-by": "highstate",
        },
      },
    },
    patches: [{ op: "replace", path: "/deployment/replicas", value: 2 }],
  },
  inputs: {
    k8sCluster,
  },
})
