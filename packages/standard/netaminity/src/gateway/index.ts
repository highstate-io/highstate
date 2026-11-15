import { generateKey, l3EndpointToL4, l4EndpointToString } from "@highstate/common"
import { common, netaminity } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"
import { createMcTunnel } from "../shared/tunnel.mc"

const { name, stateId, args, inputs, getSecret, outputs } = forUnit(netaminity.gateway)
const resourceName = args.resourceName ?? name
const targetEndpoint = inputs.targetGateway.endpoints[0]

if (!targetEndpoint) {
  throw new Error("Netaminity Gateway target gateway must expose at least one endpoint")
}

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
  endpoint: l4EndpointToString(l3EndpointToL4(targetEndpoint, args.targetGatewayPort, "tcp")),
  serviceName: resourceName,
  servicePort: args.targetGatewayPort,
  external: false,
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
  gateway: makeEntityOutput({
    entity: common.gatewayEntity,
    identity: stateId,
    meta: { title: resourceName },
    value: {
      implRef: {
        package: "@highstate/netaminity",
        data: {
          proxyGateway: inputs.proxyGateway,
          targetGateway: inputs.targetGateway,
          proxyImplRef: inputs.proxyGateway.implRef,
          targetImplRef: inputs.targetGateway.implRef,
          targetGatewayPort: args.targetGatewayPort,
          tunnelEndpoints: service.endpoints,
        },
      },
      endpoints: inputs.proxyGateway.endpoints,
      clientAuth: inputs.targetGateway.clientAuth,
    },
  }),
})
