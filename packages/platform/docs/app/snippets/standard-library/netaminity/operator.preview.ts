import { k8s, netaminity } from "@highstate/library"

const { k8sCluster } = k8s.existingCluster({
  name: "cluster",
  args: {
    autoDetectExternalIps: false,
    useKubeconfigApiEndpoint: false,
    endpoints: ["192.168.1.10"],
    apiEndpoints: ["192.168.1.10:6443"],
  },
})

netaminity.operator({
  name: "netaminity",
  args: {
    replicas: 3,
  },
  inputs: {
    k8sCluster,
  },
})
