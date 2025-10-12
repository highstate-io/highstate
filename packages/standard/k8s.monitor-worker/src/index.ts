import { InstanceServiceDefinition } from "@highstate/api/instance.v1"
import { k8s } from "@highstate/library"
import { Worker } from "@highstate/worker-sdk"
import { KubeConfig } from "@kubernetes/client-node"
import { stopInstanceInformers, updateInstanceInformers } from "./informer"

const worker = await Worker.create({
  workerMeta: {
    title: "Kubernetes Monitor Worker",
    description: "Monitors Kubernetes resources and reports their status back to Highstate.",
    icon: "devicon:kubernetes",
  },
  serviceAccountMeta: {
    title: "Kubernetes Monitor Agent",
    description: "Service account for Kubernetes Monitor Worker.",
    icon: "devicon:kubernetes",
  },
  paramsSchema: k8s.monitorWorkerParamsSchema,
})

const instanceService = worker.createClient(InstanceServiceDefinition)

worker.onUnitRegistration(async (instanceId, params) => {
  const kc = new KubeConfig()
  kc.loadFromString(params.kubeconfig)

  await updateInstanceInformers(instanceId, instanceService, kc, params.resources)
})

worker.onUnitDeregistration(async instanceId => {
  await stopInstanceInformers(instanceId)
})

await worker.start()
