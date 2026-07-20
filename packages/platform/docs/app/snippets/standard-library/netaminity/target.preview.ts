import { k8s, netaminity, network, postgresql } from "@highstate/library"

const { k8sCluster: publicCluster } = k8s.existingCluster({
  name: "public-cluster",
  args: {
    autoDetectExternalIps: false,
    useKubeconfigApiEndpoint: false,
    endpoints: ["203.0.113.10"],
    apiEndpoints: ["203.0.113.10:6443"],
  },
})

const { k8sCluster: privateCluster } = k8s.existingCluster({
  name: "private-cluster",
  args: {
    autoDetectExternalIps: false,
    useKubeconfigApiEndpoint: false,
    endpoints: ["192.168.1.10"],
    apiEndpoints: ["192.168.1.10:6443"],
  },
})

const { k8sCluster: publicNetaminityCluster } = netaminity.operator({
  name: "public-netaminity",
  inputs: {
    k8sCluster: publicCluster,
  },
})

const { k8sCluster: privateNetaminityCluster } = netaminity.operator({
  name: "private-netaminity",
  inputs: {
    k8sCluster: privateCluster,
  },
})

const { connection: privatePostgresql } = k8s.apps.postgresql({
  name: "postgresql",
  inputs: {
    k8sCluster: privateNetaminityCluster,
  },
})

const { proxy, endpoints: proxyEndpoints } = netaminity.proxy({
  name: "postgresql-proxy",
  inputs: {
    k8sCluster: publicNetaminityCluster,
    endpoints: privatePostgresql.endpoints,
  },
})

netaminity.target({
  name: "postgresql-target",
  inputs: {
    k8sCluster: privateNetaminityCluster,
    proxy,
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
    endpoints: proxyEndpoints,
  },
})

postgresql.database({
  name: "application",
  inputs: {
    connection: proxiedPostgresql,
  },
})
