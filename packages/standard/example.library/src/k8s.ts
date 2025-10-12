import { defineComponent, z } from "@highstate/contract"
import { common, dns, k3s, k8s } from "@highstate/library"

/**
 * A single-node Kubernetes cluster created on top of existing server.
 *
 * Includes all necessary components + external access point and kubernetes dashboard.
 */
export const singleNodeCluster = defineComponent({
  type: "example.single-node-cluster.v1",

  args: {
    /**
     * The FQDN where the Kubernetes dashboard will be accessible.
     */
    dashboardFqdn: z.string(),

    /**
     * The public endpoint of the gateway to override automatic detection.
     */
    gatewayEndpoint: z.string().optional(),
  },

  inputs: {
    server: common.serverEntity,
    dnsProvider: dns.providerEntity,
  },

  outputs: {
    k8sCluster: k8s.clusterEntity,
    accessPoint: common.accessPointEntity,
  },

  create({ name, args, inputs }) {
    // 1. create k3s cluster on the server
    const { k8sCluster } = k3s.cluster({
      name,
      args: {
        disabledComponents: ["traefik", "network-policy"],
        cni: "none",
      },
      inputs: {
        masters: [inputs.server],
      },
    })

    // 2. install cilium, gateway api and cert-manager on the cluster
    const { k8sCluster: withCilium } = k8s.cilium({
      name,
      inputs: { k8sCluster },
    })

    const { k8sCluster: withGatewayApi } = k8s.gatewayApi({
      name,
      inputs: { k8sCluster: withCilium },
    })

    const { k8sCluster: withCertManager } = k8s.certManager({
      name,
      inputs: { k8sCluster: withCilium },
    })

    // 3. create traefik gateway and tls issuer
    const { gateway } = k8s.apps.traefik({
      name,
      args: {
        external: true,
        endpoints: args.gatewayEndpoint ? [args.gatewayEndpoint] : undefined,
      },
      inputs: {
        k8sCluster: withGatewayApi,
      },
    })

    const { tlsIssuer } = k8s.dns01TlsIssuer({
      name,
      inputs: {
        k8sCluster: withCertManager,
        dnsProvider: inputs.dnsProvider,
      },
    })

    // 4. create access point
    const { accessPoint } = common.accessPoint({
      name,
      inputs: {
        gateway,
        dnsProviders: [inputs.dnsProvider],
        tlsIssuers: [tlsIssuer],
      },
    })

    // 5. create kubernetes dashboard
    k8s.apps.kubernetesDashboard({
      name,
      args: {
        fqdn: args.dashboardFqdn,
      },
      inputs: {
        k8sCluster: withCertManager,
        accessPoint,
      },
    })

    return {
      k8sCluster,
      accessPoint,
    }
  },

  meta: {
    title: "Single Node Cluster",
    icon: "simple-icons:kubernetes",
  },
})
