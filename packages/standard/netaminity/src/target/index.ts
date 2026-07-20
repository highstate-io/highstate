import { getProvider, Secret } from "@highstate/k8s"
import { netaminity } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { apiextensions } from "@pulumi/kubernetes"
import {
  apiVersion,
  createResourceEntity,
  type NetaminityResource,
  resolveEndpoint,
  resolveNamespace,
} from "../shared"

const { name, args, inputs, outputs } = forUnit(netaminity.target)

const resourceName = args.resourceName ?? name
const namespace = await resolveNamespace(name, args.namespace, inputs.namespace, inputs.k8sCluster)
const { endpoint } = resolveEndpoint("target", args.endpoint, inputs.endpoints)
const secret = Secret.create(name, {
  name: `${resourceName}-netaminity`,
  namespace,
  stringData: {
    secret: inputs.proxy.sharedSecret.value,
  },
})

const resource = new apiextensions.CustomResource(
  name,
  {
    apiVersion,
    kind: "Target",
    metadata: {
      name: resourceName,
      namespace: namespace.metadata.name,
    },
    spec: {
      secretRef: {
        name: secret.metadata.name,
      },
      endpoint,
      proxyEndpoint: inputs.proxy.proxyEndpoint,
      podTemplate: {
        hostNetwork: args.hostNetwork,
        distributeByNodes: args.distributeByNodes,
        ...args.podTemplate,
      },
    },
    status: undefined,
  },
  {
    dependsOn: secret,
    provider: getProvider(inputs.k8sCluster),
  },
) as NetaminityResource

export default outputs({
  target: createResourceEntity(netaminity.targetEntity, resource, inputs.k8sCluster),
})
