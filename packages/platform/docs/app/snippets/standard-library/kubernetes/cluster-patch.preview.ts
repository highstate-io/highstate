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

k8s.clusterPatch({
  name: "patch",
  args: {
    apiEndpoints: ["lb.example.com:6443"],
  },
  inputs: {
    k8sCluster,
  },
})
