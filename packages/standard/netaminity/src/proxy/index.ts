import { generateKey } from "@highstate/common"
import { getProvider, getServiceType, Secret } from "@highstate/k8s"
import { netaminity } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { apiextensions } from "@pulumi/kubernetes"
import {
  apiVersion,
  createProxyEntity,
  type NetaminityResource,
  proxyEndpointWaitFor,
  resolveEndpoint,
  resolveNamespace,
  wrapService,
} from "../shared"

const { name, args, inputs, getSecret, outputs } = forUnit(netaminity.proxy)

const resourceName = args.resourceName ?? name
const namespace = await resolveNamespace(name, args.namespace, inputs.namespace, inputs.k8sCluster)
const servicePort = args.servicePort ?? resolveEndpoint("proxy", undefined, inputs.endpoints).port
const sharedSecret = getSecret("sharedSecret", generateKey)
const secret = Secret.create(name, {
  name: `${resourceName}-netaminity`,
  namespace,
  stringData: {
    secret: sharedSecret,
  },
})

const resource = new apiextensions.CustomResource(
  name,
  {
    apiVersion,
    kind: "Proxy",
    metadata: {
      name: resourceName,
      namespace: namespace.metadata.name,
      annotations: {
        "pulumi.com/waitFor": proxyEndpointWaitFor,
      },
    },
    spec: {
      replicas: args.replicas,
      secretRef: {
        name: secret.metadata.name,
      },
      podTemplate: {
        hostNetwork: args.hostNetwork,
        distributeByNodes: args.distributeByNodes,
        ...args.podTemplate,
      },
      service: {
        enabled: args.serviceEnabled,
        name: args.serviceName,
        port: servicePort,
        type: getServiceType({ external: args.external }, inputs.k8sCluster),
      },
      proxyService: {
        name: args.proxyServiceName,
        nodePort: args.proxyNodePort,
        type: args.proxyServiceType,
      },
    },
    status: undefined,
  },
  {
    dependsOn: secret,
    provider: getProvider(inputs.k8sCluster),
  },
) as NetaminityResource

const service = args.serviceEnabled
  ? wrapService(name, args.serviceName ?? resourceName, namespace, resource)
  : undefined
const proxy = createProxyEntity(resource, inputs.k8sCluster, sharedSecret, service)

export default outputs({
  proxy,
  service: service?.entity,
  endpoints: service?.endpoints ?? [],
})
