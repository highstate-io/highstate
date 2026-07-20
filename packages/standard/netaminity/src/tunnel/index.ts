import { getProvider, getServiceType } from "@highstate/k8s"
import { netaminity } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { apiextensions } from "@pulumi/kubernetes"
import {
  apiVersion,
  createTunnelEntity,
  type NetaminityResource,
  resolveEndpoint,
  resolveNamespace,
  wrapService,
} from "../shared"

const { name, args, inputs, outputs } = forUnit(netaminity.tunnel)

const resourceName = args.resourceName ?? name
const namespace = await resolveNamespace(name, args.namespace, inputs.namespace, inputs.k8sCluster)
const { endpoint, port: endpointPort } = resolveEndpoint("tunnel", args.endpoint, inputs.endpoints)
const resource = new apiextensions.CustomResource(
  name,
  {
    apiVersion,
    kind: "Tunnel",
    metadata: {
      name: resourceName,
      namespace: namespace.metadata.name,
    },
    spec: {
      replicas: args.replicas,
      service: {
        name: args.serviceName,
        port: args.servicePort ?? endpointPort,
        type: getServiceType({ external: args.external }, inputs.k8sCluster),
      },
      podTemplate: {
        hostNetwork: args.hostNetwork,
        distributeByNodes: args.distributeByNodes,
        ...args.podTemplate,
      },
      proxy: {
        replicas: args.proxyReplicas,
        podTemplate: args.proxyPodTemplate,
        proxyService: {
          nodePort: args.proxyNodePort,
          type: args.proxyServiceType,
        },
      },
      target: {
        endpoint,
        podTemplate: args.targetPodTemplate,
      },
    },
    status: undefined,
  },
  { provider: getProvider(inputs.k8sCluster) },
) as NetaminityResource

const service = wrapService(name, args.serviceName ?? resourceName, namespace, resource)

export default outputs({
  tunnel: createTunnelEntity(resource, inputs.k8sCluster, service),
  service: service.entity,
  endpoints: service.endpoints,
})
