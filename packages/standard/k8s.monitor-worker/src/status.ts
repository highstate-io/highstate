import type { InstanceServiceClient } from "@highstate/api/instance.v1"
import type { k8s } from "@highstate/library"
import type {
  KubernetesObject,
  V1Deployment,
  V1PersistentVolumeClaim,
  V1Service,
  V1StatefulSet,
} from "@kubernetes/client-node"
import { WellKnownInstanceCustomStatus } from "@highstate/contract"
import c from "ansi-colors"
import { funnel } from "remeda"

type ResourceStatus = {
  status: "ok" | "error" | "warning" | "progressing" | "not-found"
  message?: string
}

type ResourceStatusMap = Record<
  k8s.ScopedResource["type"],
  Record<string, Record<string, ResourceStatus>>
>

type KubernetesResourceWithMetadata = {
  metadata?: { namespace?: string; name?: string }
}

type NamespaceResourceGroup = Record<
  string,
  Array<{ type: string; name: string; status: ResourceStatus }>
>

type ResourceItem = {
  type: string
  name: string
  status: ResourceStatus
}

const resourceTypeLabels: Record<k8s.ScopedResource["type"], string> = {
  deployment: "deployment",
  "stateful-set": "stateful set",
  service: "service",
  "persistent-volume-claim": "persistent volume claim",
  gateway: "gateway",
  certificate: "certificate",
  namespace: "namespace",
}

export class StatusTracker {
  private readonly statusMap: ResourceStatusMap = {
    deployment: {},
    "stateful-set": {},
    service: {},
    "persistent-volume-claim": {},
    gateway: {},
    certificate: {},
    namespace: {},
  }

  constructor(
    private readonly stateId: string,
    private readonly instanceService: InstanceServiceClient,
    public resources: k8s.ScopedResource[],
  ) {}

  private updateStatusDebouncer = funnel(
    //
    () => void this.updateInstanceStatus(),
    { minQuietPeriodMs: 200 },
  )

  updateDeploymentStatus(deployment: V1Deployment): void {
    this.updateResourceFromObject("deployment", deployment, this.getDeploymentStatus(deployment))
  }

  updateStatefulSetStatus(statefulSet: V1StatefulSet): void {
    this.updateResourceFromObject(
      "stateful-set",
      statefulSet,
      this.getStatefulSetStatus(statefulSet),
    )
  }

  updateServiceStatus(service: V1Service): void {
    this.updateResourceFromObject("service", service, this.getServiceStatus(service))
  }

  updatePersistentVolumeClaimStatus(pvc: V1PersistentVolumeClaim): void {
    this.updateResourceFromObject(
      "persistent-volume-claim",
      pvc,
      this.getPersistentVolumeClaimStatus(pvc),
    )
  }

  updateGatewayStatus(gateway: KubernetesObject): void {
    this.updateResourceFromObject("gateway", gateway, this.getGatewayStatus(gateway))
  }

  updateCertificateStatus(certificate: KubernetesObject): void {
    this.updateResourceFromObject(
      "certificate",
      certificate,
      this.getCertificateStatus(certificate),
    )
  }

  private updateResourceFromObject(
    type: k8s.ScopedResource["type"],
    resource: KubernetesResourceWithMetadata,
    status: ResourceStatus,
  ): void {
    const namespace = resource.metadata?.namespace
    const name = resource.metadata?.name

    if (!namespace || !name) {
      console.warn(`Missing namespace or name for ${type} resource`)
      return
    }

    this.updateResourceStatus(type, namespace, name, status)
  }

  private updateResourceStatus(
    type: k8s.ScopedResource["type"],
    namespace: string,
    name: string,
    status: ResourceStatus,
  ): void {
    if (!this.statusMap[type]) {
      this.statusMap[type] = {}
    }

    if (!this.statusMap[type][namespace]) {
      this.statusMap[type][namespace] = {}
    }

    this.statusMap[type][namespace][name] = status
    this.updateStatusDebouncer.call()
  }

  removeResourceStatus(type: k8s.ScopedResource["type"], namespace: string, name: string): void {
    if (this.statusMap[type]?.[namespace]) {
      delete this.statusMap[type][namespace][name]
      if (Object.keys(this.statusMap[type][namespace]).length === 0) {
        delete this.statusMap[type][namespace]
      }
    }

    void this.updateStatusDebouncer.call()
  }

  private getDeploymentStatus(deployment: V1Deployment): ResourceStatus {
    if (!deployment.status?.conditions) {
      return { status: "error", message: "deployment status not available" }
    }

    const progressingStatus = deployment.status.conditions.find(
      condition => condition.type === "Progressing" && condition.status === "True",
    )

    if (progressingStatus) {
      return {
        status: "progressing",
        message: progressingStatus.message || "deployment is progressing",
      }
    }

    const availableStatus = deployment.status.conditions.find(
      condition => condition.type === "Available",
    )

    if (availableStatus && availableStatus.status === "True") {
      return { status: "ok", message: availableStatus.message || "deployment is available" }
    }

    return {
      status: "error",
      message: availableStatus?.message || "deployment is not available",
    }
  }

  private getStatefulSetStatus(statefulSet: V1StatefulSet): ResourceStatus {
    if (!statefulSet.status) {
      return { status: "error", message: "stateful set status not available" }
    }

    const ready = statefulSet.status.readyReplicas ?? 0
    const replicas = statefulSet.status.replicas ?? 0

    if (ready === replicas && replicas > 0) {
      return { status: "ok", message: `${ready}/${replicas} replicas ready` }
    }

    if (ready < replicas) {
      return { status: "progressing", message: `${ready}/${replicas} replicas ready` }
    }

    return { status: "error", message: "stateful set not ready" }
  }

  private getServiceStatus(service: V1Service): ResourceStatus {
    if (!service.spec) {
      return { status: "error", message: "service spec not available" }
    }

    if (service.spec.type === "LoadBalancer") {
      const ingress = service.status?.loadBalancer?.ingress
      if (!ingress || ingress.length === 0) {
        return { status: "progressing", message: "waiting for load balancer" }
      }
    }

    return { status: "ok", message: `service is ready` }
  }

  private getPersistentVolumeClaimStatus(pvc: V1PersistentVolumeClaim): ResourceStatus {
    const phase = pvc.status?.phase

    switch (phase) {
      case "Bound":
        return { status: "ok", message: "pvc is bound" }
      case "Pending":
        return { status: "progressing", message: "pvc is pending" }
      case "Lost":
        return { status: "error", message: "pvc is lost" }
      default:
        return { status: "error", message: `pvc status unknown: ${phase}` }
    }
  }

  private getGatewayStatus(gateway: KubernetesObject): ResourceStatus {
    const status = (
      gateway as KubernetesObject & {
        status?: { conditions?: Array<{ type: string; status: string; message?: string }> }
      }
    ).status
    if (!status) {
      return { status: "error", message: "gateway status not available" }
    }

    const conditions = status.conditions
    if (!conditions) {
      return { status: "progressing", message: "gateway is starting" }
    }

    const acceptedCondition = conditions.find(c => c.type === "Accepted")
    const programmedCondition = conditions.find(c => c.type === "Programmed")

    if (acceptedCondition?.status === "True" && programmedCondition?.status === "True") {
      return { status: "ok", message: "gateway is ready" }
    }

    if (acceptedCondition?.status === "False") {
      return { status: "error", message: acceptedCondition.message || "gateway not accepted" }
    }

    return { status: "progressing", message: "gateway is starting" }
  }

  private getCertificateStatus(certificate: KubernetesObject): ResourceStatus {
    const status = (
      certificate as KubernetesObject & {
        status?: { conditions?: Array<{ type: string; status: string; message?: string }> }
      }
    ).status
    if (!status) {
      return { status: "error", message: "certificate status not available" }
    }

    const conditions = status.conditions
    if (!conditions) {
      return { status: "progressing", message: "certificate is provisioning" }
    }

    const readyCondition = conditions.find(c => c.type === "Ready")

    if (readyCondition?.status === "True") {
      return { status: "ok", message: "certificate is ready" }
    }

    if (readyCondition?.status === "False") {
      return { status: "error", message: readyCondition.message || "certificate not ready" }
    }

    return { status: "progressing", message: "certificate is provisioning" }
  }

  private async updateInstanceStatus(): Promise<void> {
    try {
      console.log("updating instance status")

      const statusMap = this.resolveStatusMap()
      const instanceStatus = this.resolveInstanceStatus(statusMap)

      await this.instanceService.updateCustomStatus({
        stateId: this.stateId,
        status: {
          name: "k8s-monitor",
          meta: {
            title: "Monitoring",
          },
          value: instanceStatus,
          message: this.renderStatusMessage(statusMap),
          order: 0,
        },
      })
    } catch (error) {
      console.error("Failed to update instance status:", error)
    }
  }

  private resolveStatusMap(): ResourceStatusMap {
    const resolvedStatusMap: ResourceStatusMap = {
      deployment: {},
      "stateful-set": {},
      service: {},
      "persistent-volume-claim": {},
      gateway: {},
      certificate: {},
      namespace: {},
    }

    for (const resource of this.resources) {
      const { type, metadata } = resource
      const { namespace, name } = metadata

      const existingStatus = this.statusMap[type][namespace]?.[name]

      if (!resolvedStatusMap[type][namespace]) {
        resolvedStatusMap[type][namespace] = {}
      }

      resolvedStatusMap[type][namespace][name] = existingStatus ?? { status: "not-found" }
    }

    return resolvedStatusMap
  }

  private resolveInstanceStatus(statusMap: ResourceStatusMap): WellKnownInstanceCustomStatus {
    let status = WellKnownInstanceCustomStatus.Healthy

    for (const type of Object.keys(statusMap) as k8s.ScopedResource["type"][]) {
      for (const namespace of Object.keys(statusMap[type])) {
        for (const name of Object.keys(statusMap[type][namespace])) {
          const resourceStatus = statusMap[type][namespace][name]

          if (resourceStatus.status === "error") {
            return WellKnownInstanceCustomStatus.Error
          }

          if (resourceStatus.status === "warning") {
            status = WellKnownInstanceCustomStatus.Warning
          }

          if (resourceStatus.status === "progressing") {
            status = WellKnownInstanceCustomStatus.Progressing
          }

          if (resourceStatus.status === "not-found") {
            status = WellKnownInstanceCustomStatus.Down
          }
        }
      }
    }

    return status
  }

  private renderStatusMessage(statusMap: ResourceStatusMap): string {
    const namespaceGroups = this.groupResourcesByNamespace(statusMap)
    const namespaces = Object.keys(namespaceGroups).sort()

    if (namespaces.length === 0) {
      return "No resources to display"
    }

    const groups = namespaces.map(namespace => {
      const resources = namespaceGroups[namespace]
      const lines = this.renderResourcesForNamespace(resources)

      if (namespaces.length === 1) {
        return lines.join("\n")
      }

      return [c.bold(c.blue(namespace)), ...lines].join("\n")
    })

    return groups.join("\n\n")
  }

  private groupResourcesByNamespace(statusMap: ResourceStatusMap): NamespaceResourceGroup {
    const namespaceGroups: NamespaceResourceGroup = {}

    for (const [type, nsStatuses] of Object.entries(statusMap)) {
      for (const [namespace, resources] of Object.entries(nsStatuses)) {
        if (Object.keys(resources).length === 0) continue

        if (!namespaceGroups[namespace]) {
          namespaceGroups[namespace] = []
        }

        for (const [name, status] of Object.entries(resources)) {
          namespaceGroups[namespace].push({ type, name, status })
        }
      }
    }

    return namespaceGroups
  }

  private renderResourcesForNamespace(resources: ResourceItem[]): string[] {
    // terminal width for 800x600 ANSI display
    const terminalWidth = 80
    const minSpaces = 3

    // calculate the maximum width needed for left part to align all status messages
    const leftParts = resources.map(({ type, name }) => {
      const resourceLabel = resourceTypeLabels[type as k8s.ScopedResource["type"]] ?? type
      return `${resourceLabel} "${c.blueBright(name)}"`
    })

    return resources.map(({ status }, index) => {
      const leftPart = leftParts[index]
      const statusText = status.message ?? status.status // plain text for length calculation
      const rightPart = this.getStyleColorizer(status.status)(statusText) // colored version

      // calculate spaces to fill the line, ensuring right-aligned status
      const availableSpace = terminalWidth - c.stripColor(leftPart).length - statusText.length
      const spacesCount = Math.max(minSpaces, availableSpace)
      const spaces = " ".repeat(spacesCount)

      return `${leftPart}${spaces}${rightPart}`
    })
  }

  private getStyleColorizer(status: ResourceStatus["status"]): c.StyleFunction {
    switch (status) {
      case "ok":
        return c.green
      case "error":
        return c.redBright
      case "warning":
        return c.yellow
      case "progressing":
        return c.blue
      case "not-found":
        return c.redBright
      default:
        return c.white
    }
  }
}
