import type { InstanceServiceClient } from "@highstate/api/instance.v1"
import type { k8s } from "@highstate/library"
import {
  AppsV1Api,
  CoreV1Api,
  CustomObjectsApi,
  type Informer,
  type KubeConfig,
  type KubernetesObject,
  makeInformer,
} from "@kubernetes/client-node"
import { StatusTracker } from "./status"

const informeres: Map<string, Informer<KubernetesObject>[]> = new Map()
const statusTrackers = new Map<string, StatusTracker>()

type SupportedKind =
  | "Deployment"
  | "StatefulSet"
  | "Service"
  | "PersistentVolumeClaim"
  | "Gateway"
  | "Certificate"

function setupInformerEvents<T extends KubernetesObject>(
  informer: Informer<T>,
  resourceType: SupportedKind,
  statusTracker: StatusTracker,
  updateCallback: (obj: T) => void,
): void {
  informer.on("add", obj => {
    try {
      updateCallback(obj)
    } catch (error) {
      console.error(`Error handling add event for ${resourceType}:`, error)
    }
  })

  informer.on("update", obj => {
    try {
      updateCallback(obj)
    } catch (error) {
      console.error(`Error handling update event for ${resourceType}:`, error)
    }
  })

  informer.on("delete", obj => {
    try {
      const namespace = obj.metadata?.namespace
      const name = obj.metadata?.name
      if (namespace && name) {
        statusTracker.removeResourceStatus(resourceType, namespace, name)
      }
    } catch (error) {
      console.error(`Error handling delete event for ${resourceType}:`, error)
    }
  })

  informer.on("error", error => {
    console.error(`Informer error for ${resourceType}:`, error)
  })
}

function createResourceInformer(
  statusTracker: StatusTracker,
  kc: KubeConfig,
  resource: k8s.NamespacedResource,
): Informer<KubernetesObject> {
  const appsApi = kc.makeApiClient(AppsV1Api)

  switch (resource.kind) {
    case "Deployment": {
      const listFn = () =>
        appsApi.listNamespacedDeployment({ namespace: resource.metadata.namespace })

      const informer = makeInformer(
        kc,
        `/apis/apps/v1/namespaces/${resource.metadata.namespace}/deployments`,
        listFn,
      )

      setupInformerEvents(
        informer,
        "Deployment",
        statusTracker,
        //
        deployment => statusTracker.updateDeploymentStatus(deployment),
      )

      return informer
    }
    case "StatefulSet": {
      const listFn = () =>
        appsApi.listNamespacedStatefulSet({ namespace: resource.metadata.namespace })

      const informer = makeInformer(
        kc,
        `/apis/apps/v1/namespaces/${resource.metadata.namespace}/statefulsets`,
        listFn,
      )

      setupInformerEvents(
        informer,
        "StatefulSet",
        statusTracker,
        //
        statefulSet => statusTracker.updateStatefulSetStatus(statefulSet),
      )

      return informer
    }
    case "Service": {
      const coreApi = kc.makeApiClient(CoreV1Api)
      const listFn = () => coreApi.listNamespacedService({ namespace: resource.metadata.namespace })

      const informer = makeInformer(
        kc,
        `/api/v1/namespaces/${resource.metadata.namespace}/services`,
        listFn,
      )

      setupInformerEvents(
        informer,
        "Service",
        statusTracker,
        //
        service => statusTracker.updateServiceStatus(service),
      )

      informer.on("error", err => {
        console.error("Service informer error:", err)
      })

      return informer
    }
    case "PersistentVolumeClaim": {
      const coreApi = kc.makeApiClient(CoreV1Api)
      const listFn = () =>
        coreApi.listNamespacedPersistentVolumeClaim({ namespace: resource.metadata.namespace })

      const informer = makeInformer(
        kc,
        `/api/v1/namespaces/${resource.metadata.namespace}/persistentvolumeclaims`,
        listFn,
      )

      setupInformerEvents(
        informer,
        "PersistentVolumeClaim",
        statusTracker,
        //
        pvc => statusTracker.updatePersistentVolumeClaimStatus(pvc),
      )

      return informer
    }
    case "Gateway": {
      // Note: Gateway API resources may require different API groups.
      const customApi = kc.makeApiClient(CustomObjectsApi)
      const listFn = () =>
        customApi.listNamespacedCustomObject({
          group: "gateway.networking.k8s.io",
          version: "v1",
          namespace: resource.metadata.namespace,
          plural: "gateways",
        })

      const informer = makeInformer(
        kc,
        `/apis/gateway.networking.k8s.io/v1/namespaces/${resource.metadata.namespace}/gateways`,
        listFn,
      )

      setupInformerEvents(
        informer,
        "Gateway",
        statusTracker,
        //
        gateway => statusTracker.updateGatewayStatus(gateway),
      )

      return informer
    }
    case "Certificate": {
      // cert-manager certificates.
      const customApi = kc.makeApiClient(CustomObjectsApi)
      const listFn = () =>
        customApi.listNamespacedCustomObject({
          group: "cert-manager.io",
          version: "v1",
          namespace: resource.metadata.namespace,
          plural: "certificates",
        })

      const informer = makeInformer(
        kc,
        `/apis/cert-manager.io/v1/namespaces/${resource.metadata.namespace}/certificates`,
        listFn,
      )

      setupInformerEvents(
        informer,
        "Certificate",
        statusTracker,
        //
        certificate => statusTracker.updateCertificateStatus(certificate),
      )

      return informer
    }
  }

  throw new Error(`Unsupported resource kind: ${resource.kind}`)
}

export async function updateInstanceInformers(
  stateId: string,
  instanceService: InstanceServiceClient,
  kc: KubeConfig,
  resources: k8s.NamespacedResource[],
): Promise<void> {
  let statusTracker = statusTrackers.get(stateId)
  if (statusTracker) {
    statusTracker.resources = resources
  } else {
    statusTracker = new StatusTracker(stateId, instanceService, resources)
    statusTrackers.set(stateId, statusTracker)
  }

  const newInformers = resources.map(resource =>
    createResourceInformer(statusTracker, kc, resource),
  )
  const oldInformers = informeres.get(stateId) ?? []

  for (const newInformer of newInformers) {
    try {
      await newInformer.start()
    } catch (error) {
      console.error(`Failed to start informer`, error)
    }
  }

  for (const oldInformer of oldInformers) {
    if (!newInformers.includes(oldInformer)) {
      try {
        await oldInformer.stop()
      } catch (error) {
        console.error(`Failed to stop informer`, error)
      }
    }
  }

  informeres.set(stateId, newInformers)
}

export async function stopInstanceInformers(instanceId: string): Promise<void> {
  const informers = informeres.get(instanceId)
  if (!informers) {
    return
  }

  for (const informer of informers) {
    try {
      await informer.stop()
    } catch (error) {
      console.error(`Failed to stop informer`, error)
    }
  }

  informeres.delete(instanceId)
  statusTrackers.delete(instanceId)
}
