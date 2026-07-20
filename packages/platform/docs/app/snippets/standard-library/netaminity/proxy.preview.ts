import { k8s, netaminity, network } from "@highstate/library"

const { k8sCluster } = k8s.existingCluster({
  name: "public-cluster",
  args: {
    autoDetectExternalIps: false,
    useKubeconfigApiEndpoint: false,
    endpoints: ["203.0.113.10"],
    apiEndpoints: ["203.0.113.10:6443"],
  },
})

const { k8sCluster: netaminityCluster } = netaminity.operator({
  name: "netaminity",
  inputs: {
    k8sCluster,
  },
})

const { endpoint } = network.l4Endpoint({
  name: "postgresql",
  args: {
    endpoint: "postgresql.private.svc:5432",
  },
})

netaminity.proxy({
  name: "postgresql-proxy",
  inputs: {
    k8sCluster: netaminityCluster,
    endpoints: endpoint,
  },
})
