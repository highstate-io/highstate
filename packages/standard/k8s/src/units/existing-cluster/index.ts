import {
  l3EndpointToString,
  l4EndpointToString,
  parseL3Endpoint,
  parseL4Endpoint,
} from "@highstate/common"
import { type ImplementationReference, k8s } from "@highstate/library"
import { forUnit, secret, toPromise } from "@highstate/pulumi"
import { AppsV1Api, KubeConfig } from "@kubernetes/client-node"
import { core, Provider } from "@pulumi/kubernetes"
import { createK8sTerminal, detectExternalIps } from "../../cluster"

const { name, args, secrets, outputs } = forUnit(k8s.existingCluster)

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

const externalIps =
  args.externalIps ?? (await detectExternalIps(kubeConfig, args.internalIpsPolicy))

const endpoints = externalIps.map(parseL3Endpoint)
const apiEndpoints = [parseL4Endpoint(kubeConfig.clusters[0].server.replace("https://", ""))]

const kubeSystem = core.v1.Namespace.get("kube-system", "kube-system", { provider })

export default outputs({
  k8sCluster: {
    id: kubeSystem.metadata.uid,
    connectionId: kubeSystem.metadata.uid,
    name,
    networkPolicyImplRef,
    externalIps,
    endpoints,
    apiEndpoints,
    quirks: args.quirks,
    kubeconfig: secret(kubeconfigContent),
  },

  endpoints,
  apiEndpoints,

  $terminals: [createK8sTerminal(kubeconfigContent)],

  $statusFields: {
    clusterId: kubeSystem.metadata.uid,
    endpoints: endpoints.map(l3EndpointToString),
    apiEndpoints: apiEndpoints.map(l4EndpointToString),
  },
})
