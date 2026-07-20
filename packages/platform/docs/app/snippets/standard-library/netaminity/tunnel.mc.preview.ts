import { k8s, netaminity, network, postgresql } from "@highstate/library"

const { k8sCluster: proxyCluster } = k8s.existingCluster({
  name: "proxy-cluster",
  args: {
    autoDetectExternalIps: false,
    useKubeconfigApiEndpoint: false,
    endpoints: ["203.0.113.10"],
    apiEndpoints: ["203.0.113.10:6443"],
  },
})

const { k8sCluster: targetCluster } = k8s.existingCluster({
  name: "target-cluster",
  args: {
    autoDetectExternalIps: false,
    useKubeconfigApiEndpoint: false,
    endpoints: ["192.168.1.10"],
    apiEndpoints: ["192.168.1.10:6443"],
  },
})

const { k8sCluster: proxyNetaminityCluster } = netaminity.operator({
  name: "proxy-netaminity",
  inputs: {
    k8sCluster: proxyCluster,
  },
})

const { k8sCluster: targetNetaminityCluster } = netaminity.operator({
  name: "target-netaminity",
  inputs: {
    k8sCluster: targetCluster,
  },
})

const { connection: privatePostgresql } = k8s.apps.postgresql({
  name: "postgresql",
  inputs: {
    k8sCluster: targetNetaminityCluster,
  },
})

const { endpoints: tunnelEndpoints } = netaminity.tunnelMc({
  name: "postgresql",
  args: {
    replicas: 3,
  },
  inputs: {
    proxyK8sCluster: proxyNetaminityCluster,
    targetK8sCluster: targetNetaminityCluster,
    endpoints: privatePostgresql.endpoints,
  },
})

const { entity: proxiedPostgresql } = network.l4EndpointReplacer({
  name: "proxied-postgresql",
  args: {
    includeCurrent: false,
  },
  inputs: {
    entity: privatePostgresql,
    endpoints: tunnelEndpoints,
  },
})

postgresql.database({
  name: "application",
  inputs: {
    connection: proxiedPostgresql,
  },
})
