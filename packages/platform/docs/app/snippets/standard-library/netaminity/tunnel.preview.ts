import { k8s, netaminity, network, postgresql } from "@highstate/library"

const { k8sCluster } = k8s.existingCluster({
  name: "cluster",
  args: {
    autoDetectExternalIps: false,
    useKubeconfigApiEndpoint: false,
    endpoints: ["192.168.1.10"],
    apiEndpoints: ["192.168.1.10:6443"],
  },
})

const { k8sCluster: netaminityCluster } = netaminity.operator({
  name: "netaminity",
  inputs: {
    k8sCluster,
  },
})

const { connection: privatePostgresql } = k8s.apps.postgresql({
  name: "postgresql",
  inputs: {
    k8sCluster: netaminityCluster,
  },
})

const { endpoints: tunnelEndpoints } = netaminity.tunnel({
  name: "postgresql",
  args: {
    proxyServiceType: "ClusterIP",
  },
  inputs: {
    k8sCluster: netaminityCluster,
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
