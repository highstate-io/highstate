import { defineUnit, z } from "@highstate/contract"
import { tlsIssuerEntity } from "../common"
import * as dns from "../dns"
import { clusterEntity } from "./shared"

export const tlsIssuerDataSchema = z.object({
  /**
   * The Kubernetes cluster to use for creating gateway routes.
   */
  cluster: clusterEntity.schema,

  /**
   * The name of the cluster issuer which should be used to issue TLS certificates.
   */
  clusterIssuerName: z.string(),
})

/**
 * The cert-manager installed on the Kubernetes cluster.
 */
export const certManager = defineUnit({
  type: "k8s.cert-manager.v1",

  args: {
    /**
     * Whether to enable the native support for Gateway API in cert-manager.
     *
     * Note that this can conflict with "Gateway API" unit since it is bringing its own CRDs.
     */
    enableGatewayApi: z.boolean().default(false),
  },

  inputs: {
    k8sCluster: clusterEntity,
  },

  outputs: {
    k8sCluster: clusterEntity,
  },

  meta: {
    title: "Cert Manager",
    icon: "simple-icons:letsencrypt",
    category: "Kubernetes",
  },

  source: {
    package: "@highstate/k8s",
    path: "units/cert-manager",
  },
})

/**
 * The DNS01 TLS issuer for issuing certificates using DNS01 challenge.
 */
export const dns01TlsIssuer = defineUnit({
  type: "k8s.dns01-issuer.v1",

  inputs: {
    k8sCluster: clusterEntity,
    dnsProvider: dns.providerEntity,
  },

  outputs: {
    tlsIssuer: tlsIssuerEntity,
  },

  meta: {
    title: "DNS01 Issuer",
    icon: "mdi:certificate",
    category: "Kubernetes",
  },

  source: {
    package: "@highstate/k8s",
    path: "units/dns01-issuer",
  },
})

export type TlsIssuerData = z.infer<typeof tlsIssuerDataSchema>
