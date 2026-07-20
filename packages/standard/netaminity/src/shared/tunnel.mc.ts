import type { k8s } from "@highstate/library"
import type { ComponentResourceOptions, Input } from "@highstate/pulumi"
import { getProvider, Namespace, Secret, Service } from "@highstate/k8s"
import { apiextensions } from "@pulumi/kubernetes"
import { apiVersion, type NetaminityResource, proxyEndpointWaitFor } from "./index"

const tunnelNameLabel = "netaminity.exeteres.net/tunnel-name"
const tunnelIndexLabel = "netaminity.exeteres.net/tunnel-index"
const appLabels = {
  "app.kubernetes.io/managed-by": "netaminity",
  "app.kubernetes.io/name": "netaminity",
}

export type McTunnelArgs = {
  name: string
  resourceName: string
  proxyNamespaceName?: string
  targetNamespaceName?: string
  proxyNamespace?: k8s.Namespace
  targetNamespace?: k8s.Namespace
  proxyCluster: k8s.Cluster
  targetCluster: k8s.Cluster
  replicas: number
  proxyReplicas: number
  endpoint: string
  serviceName: string
  servicePort: number
  external: boolean
  proxyServiceType: "ClusterIP" | "NodePort" | "LoadBalancer"
  proxyNodePort?: number
  podTemplate: Record<string, unknown>
  proxyPodTemplate: Record<string, unknown>
  targetPodTemplate: Record<string, unknown>
  sharedSecret: Input<string>
  opts?: ComponentResourceOptions
}

export async function createMcTunnel(args: McTunnelArgs): Promise<Service> {
  if (args.proxyNodePort && args.proxyNodePort + args.replicas - 1 > 65535) {
    throw new Error("Netaminity MC Tunnel proxyNodePort plus replicas exceeds 65535")
  }

  const proxyNamespace = await Namespace.createOrGet(`${args.name}-proxy`, {
    name: args.proxyNamespaceName ?? args.resourceName,
    cluster: args.proxyCluster,
    existing: args.proxyNamespace,
  })
  const targetNamespace = await Namespace.createOrGet(`${args.name}-target`, {
    name: args.targetNamespaceName ?? args.resourceName,
    cluster: args.targetCluster,
    existing: args.targetNamespace,
  })
  const secretName = `netaminity-tunnel-${args.resourceName}`
  const proxySecret = Secret.create(`${args.name}-proxy`, {
    name: secretName,
    namespace: proxyNamespace,
    stringData: { secret: args.sharedSecret },
  })
  const targetSecret = Secret.create(`${args.name}-target`, {
    name: secretName,
    namespace: targetNamespace,
    stringData: { secret: args.sharedSecret },
  })
  const proxies: NetaminityResource[] = []

  for (let index = 0; index < args.replicas; index += 1) {
    const childName = `${args.resourceName}-${index}`
    const replicaLabels = {
      [tunnelNameLabel]: args.resourceName,
      [tunnelIndexLabel]: String(index),
    }
    const proxy = new apiextensions.CustomResource(
      `${args.name}-proxy-${index}`,
      {
        apiVersion,
        kind: "Proxy",
        metadata: {
          name: childName,
          namespace: proxyNamespace.metadata.name,
          labels: childLabels("proxy", args.resourceName, replicaLabels),
          annotations: {
            "pulumi.com/waitFor": proxyEndpointWaitFor,
          },
        },
        spec: {
          secretRef: { name: proxySecret.metadata.name },
          replicas: args.proxyReplicas,
          podTemplate: mergePodTemplates(args.podTemplate, args.proxyPodTemplate),
          service: { enabled: false, port: args.servicePort },
          proxyService: {
            nodePort: args.proxyNodePort ? args.proxyNodePort + index : undefined,
            type: args.proxyServiceType,
          },
        },
        status: undefined,
      },
      {
        ...args.opts,
        dependsOn: proxySecret,
        provider: getProvider(args.proxyCluster),
      },
    ) as NetaminityResource

    new apiextensions.CustomResource(
      `${args.name}-target-${index}`,
      {
        apiVersion,
        kind: "Target",
        metadata: {
          name: childName,
          namespace: targetNamespace.metadata.name,
          labels: childLabels("target", args.resourceName, replicaLabels),
        },
        spec: {
          secretRef: { name: targetSecret.metadata.name },
          endpoint: args.endpoint,
          proxyEndpoint: proxy.status.apply(status => String(status?.proxyEndpoint ?? "")),
          podTemplate: mergePodTemplates(args.podTemplate, args.targetPodTemplate),
        },
        status: undefined,
      },
      {
        ...args.opts,
        dependsOn: targetSecret,
        provider: getProvider(args.targetCluster),
      },
    )
    proxies.push(proxy)
  }

  return Service.create(
    args.name,
    {
      name: args.serviceName,
      namespace: proxyNamespace,
      external: args.external,
      metadata: {
        annotations: {
          "pulumi.com/skipAwait": "true",
        },
        labels: {
          ...appLabels,
          "app.kubernetes.io/component": "proxy",
          "netaminity.exeteres.net/resource-kind": "Tunnel",
          "netaminity.exeteres.net/resource-name": args.resourceName,
          [tunnelNameLabel]: args.resourceName,
        },
      },
      selector: {
        "app.kubernetes.io/component": "proxy",
        "app.kubernetes.io/name": "netaminity",
        [tunnelNameLabel]: args.resourceName,
      },
      port: {
        name: "tunnel",
        port: args.servicePort,
        protocol: "TCP",
        targetPort: args.servicePort,
      },
    },
    { ...args.opts, dependsOn: proxies },
  )
}

function mergePodTemplates(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  return { ...base, ...override }
}

function childLabels(
  component: "proxy" | "target",
  tunnelName: string,
  extra: Record<string, string>,
): Record<string, string> {
  return {
    ...appLabels,
    ...extra,
    "app.kubernetes.io/component": component,
    "netaminity.exeteres.net/resource-kind": "Tunnel",
    "netaminity.exeteres.net/resource-name": tunnelName,
  }
}
