import { common, k3s, k8s } from "@highstate/library"

const { server: master } = common.existingServer({
  name: "master",
  args: {
    endpoint: "192.168.1.10",
  },
})

const { k8sCluster } = k3s.cluster({
  name: "my-cluster",
  args: {
    // We'll install Cilium, so disable the default Flannel.
    cni: "none",
  },
  inputs: {
    masters: [master],
  },
})

k8s.cilium({
  name: "cilium",
  args: {
    enableHubble: true,
  },
  inputs: {
    k8sCluster,
  },
})
