import type { Namespace } from "@highstate/k8s"
import type { k8s } from "@highstate/library"
import { addEndpointMetadata, l3EndpointToL4 } from "@highstate/common"
import { interpolate, type Output, toPromise } from "@highstate/pulumi"

/**
 * Creates a bootstrap service endpoint for the given app in the specified namespace.
 *
 * It can be used to pass to backup jobs or other components that run before the main workload and its endpoints are available.
 *
 * @param namespace The namespace where the app is deployed.
 * @param appName The name of the application.
 * @returns An output containing the service endpoint with appropriate metadata.
 */
export function createBootstrapServiceEndpoint(
  namespace: Namespace,
  appName: string,
  port: number,
): Output<k8s.ServiceEndpoint> {
  const serviceHost = interpolate`${appName}.${namespace.metadata.name}.svc.cluster.local`

  return serviceHost.apply(async host =>
    addEndpointMetadata(l3EndpointToL4(host, port), {
      "k8s.service": {
        clusterId: await toPromise(namespace.cluster.id),
        clusterName: await toPromise(namespace.cluster.name),
        name: appName,
        namespace: appName,
        selector: {
          "app.kubernetes.io/name": appName,
          "app.kubernetes.io/instance": appName,
        },
        targetPort: port,
        isInternal: true,
      },
    }),
  )
}
