import { generateKey } from "@highstate/common"
import { netaminity } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { resolveEndpoint } from "../shared"
import { createMcTunnel } from "../shared/tunnel.mc"

const { name, args, inputs, getSecret, outputs } = forUnit(netaminity.tunnelMc)
const resourceName = args.resourceName ?? name
const { endpoint, port: endpointPort } = resolveEndpoint("tunnel", args.endpoint, inputs.endpoints)
const servicePort = args.servicePort ?? endpointPort
const service = await createMcTunnel({
  name,
  resourceName,
  proxyNamespaceName: args.proxyNamespace,
  targetNamespaceName: args.targetNamespace,
  proxyNamespace: inputs.proxyNamespace,
  targetNamespace: inputs.targetNamespace,
  proxyCluster: inputs.proxyK8sCluster,
  targetCluster: inputs.targetK8sCluster,
  replicas: args.replicas,
  proxyReplicas: args.proxyReplicas,
  endpoint,
  serviceName: args.serviceName ?? resourceName,
  servicePort,
  external: args.external,
  proxyServiceType: args.proxyServiceType,
  proxyNodePort: args.proxyNodePort,
  podTemplate: {
    hostNetwork: args.hostNetwork,
    distributeByNodes: args.distributeByNodes,
    ...args.podTemplate,
  },
  proxyPodTemplate: args.proxyPodTemplate,
  targetPodTemplate: args.targetPodTemplate,
  sharedSecret: getSecret("sharedSecret", generateKey),
})

export default outputs({
  service: service.entity,
  endpoints: service.endpoints,
})
