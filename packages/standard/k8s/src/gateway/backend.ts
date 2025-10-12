import type { core } from "@pulumi/kubernetes"
import { type Input, type Output, output, type Unwrap } from "@highstate/pulumi"
import { Service } from "../service"

export interface FullBackendRef {
  /**
   * The name of the resource being referenced.
   */
  name: Input<string>

  /**
   * The namespace of the resource being referenced.
   * May be undefined if the resource is not in a namespace.
   */
  namespace?: Input<string | undefined>

  /**
   * The port of the resource being referenced.
   */
  port: Input<number>
}

export interface ServiceBackendRef {
  /**
   * The name of the service being referenced.
   */
  service: Input<core.v1.Service>

  /**
   * The port of the service being referenced.
   */
  port: Input<number>
}

export type BackendRef = FullBackendRef | ServiceBackendRef | Service

export function resolveBackendRef(ref: BackendRef): Output<Unwrap<FullBackendRef>> {
  if (Service.isInstance(ref)) {
    return output({
      name: ref.metadata.name,
      namespace: ref.metadata.namespace,
      port: ref.spec.ports[0].port,
    })
  }

  if ("service" in ref) {
    const service = output(ref.service)

    return output({
      name: service.metadata.name,
      namespace: service.metadata.namespace,
      port: ref.port,
    })
  }

  return output({
    name: ref.name,
    namespace: ref.namespace,
    port: ref.port,
  })
}
