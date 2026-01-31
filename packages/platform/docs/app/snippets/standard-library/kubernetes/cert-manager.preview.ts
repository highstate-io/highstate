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

k8s.certManager({
  name: "cert-manager",
  args: {
    enableGatewayApi: false,
  },
  inputs: {
    k8sCluster,
  },
})
