import {
  l3EndpointToString,
  l4EndpointToString,
  mergeAddresses,
  mergeEndpoints,
  parseAddress,
  parseEndpoint,
  parseEndpoints,
} from "@highstate/common"
import { common, type ImplementationReference, k8s } from "@highstate/library"
import { forUnit, makeEntityOutput, toPromise } from "@highstate/pulumi"
import { AppsV1Api, KubeConfig } from "@kubernetes/client-node"
import { core, Provider } from "@pulumi/kubernetes"
import { createK8sTerminal, detectExternalIps } from "../../cluster"

const { name, args, inputs, secrets, outputs } = forUnit(k8s.existingCluster)

const kubeconfigContent = await toPromise(secrets.kubeconfig.apply(JSON.stringify))

const provider = new Provider(name, { kubeconfig: kubeconfigContent })

let networkPolicyImplRef: ImplementationReference | undefined

const kubeConfig = new KubeConfig()
kubeConfig.loadFromString(kubeconfigContent)

const appsApi = kubeConfig.makeApiClient(AppsV1Api)

const hasCilium = await appsApi
  .readNamespacedDaemonSet({ name: "cilium", namespace: "kube-system" })
  .then(() => true)
  .catch(() => false)

if (hasCilium) {
  networkPolicyImplRef = {
    package: "@highstate/cilium",
    data: {},
  }
}

// calculate external IPs
let externalIps = args.externalIps.map(parseAddress)

if (args.autoDetectExternalIps) {
  const detectedIps = await detectExternalIps(kubeConfig, args.internalIpsPolicy)
  externalIps = mergeAddresses([...externalIps, ...detectedIps])
}

// calculate endpoints
let endpoints = parseEndpoints([...args.endpoints, ...inputs.endpoints])

if (args.useExternalIpsAsEndpoints) {
  const ipEndpoints = externalIps.map(ip => parseEndpoint(ip))
  endpoints = mergeEndpoints([...endpoints, ...ipEndpoints])
}

// calculate api endpoints
let apiEndpoints = parseEndpoints([...args.apiEndpoints, ...inputs.endpoints], 4)

if (args.useKubeconfigApiEndpoint) {
  const configEndpoint = parseEndpoint(kubeConfig.clusters[0].server.replace("https://", ""), 4)
  apiEndpoints = mergeEndpoints([configEndpoint, ...apiEndpoints])
}

const kubeSystem = core.v1.Namespace.get("kube-system", "kube-system", { provider })

export default outputs({
  k8sCluster: makeEntityOutput({
    entity: k8s.clusterEntity,
    identity: kubeSystem.metadata.uid,
    value: {
      id: kubeSystem.metadata.uid,
      connectionId: kubeSystem.metadata.uid,
      name,
      networkPolicyImplRef,
      externalIps,
      endpoints,
      apiEndpoints,
      quirks: args.quirks,
      kubeconfig: makeEntityOutput({
        entity: common.fileEntity,
        identity: `${name}:kubeconfig`,
        meta: {
          title: "Kubeconfig",
        },
        value: {
          content: {
            type: "embedded-secret",
            value: kubeconfigContent,
          },
          meta: {
            name: "kubeconfig",
            contentType: "text/yaml",
            mode: 0o600,
          },
        },
      }),
    },
  }),

  $terminals: [createK8sTerminal(kubeconfigContent)],

  $statusFields: {
    clusterId: kubeSystem.metadata.uid,
    endpoints: endpoints.map(l3EndpointToString),
    apiEndpoints: apiEndpoints.map(l4EndpointToString),
  },
})
