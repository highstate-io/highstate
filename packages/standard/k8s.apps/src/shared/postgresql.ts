import type { k8s, postgresql } from "@highstate/library"
import type { Input } from "@highstate/pulumi"
import { l3EndpointToString, l4EndpointToString } from "@highstate/common"
import { getEntityId } from "@highstate/contract"
import { type Namespace, requireBestEndpoint, Secret } from "@highstate/k8s"
import { output } from "@pulumi/pulumi"

/**
 * Constructs a PostgreSQL connection URL from the given connection entity and cluster.
 *
 * @param connection The PostgreSQL connection entity containing endpoints and credentials.
 * @param cluster The Kubernetes cluster to determine the best endpoint for connection.
 * @returns A PostgreSQL connection URL string.
 * @throws If the connection does not have a database specified or if no suitable endpoint is found.
 */
export function getPostgresqlConnectionUrl(
  connection: postgresql.Connection,
  cluster: k8s.Cluster,
): string {
  const {
    endpoints,
    credentials: { username, password },
    database,
  } = connection

  if (!database) {
    throw new Error(`Connection "${getEntityId(connection)}" does not have a database specified`)
  }

  const endpoint = requireBestEndpoint(endpoints, cluster)

  return `postgresql://${username}:${password.value}@${l4EndpointToString(endpoint)}/${database}`
}

/**
 * Creates a Kubernetes Secret containing the PostgreSQL connection credentials and endpoint information.
 *
 * @param name The name of the Secret to create.
 * @param namespace The Kubernetes Namespace in which to create the Secret.
 * @param connection The PostgreSQL connection entity containing credentials and endpoints.
 * @returns A Kubernetes Secret resource with the PostgreSQL connection details.
 * @throws If the connection does not have a database specified or if no suitable endpoint is found.
 */
export function createPostgresqlCredentialsSecret(
  name: string,
  namespace: Input<Namespace>,
  connection: postgresql.Connection,
): Secret {
  const {
    credentials: { username, password },
    database,
  } = connection

  if (!database) {
    throw new Error(`Connection "${getEntityId(connection)}" does not have a database specified`)
  }

  return Secret.create(name, {
    namespace,
    stringData: {
      username,
      password: password.value,
      database,
      endpoint: output(namespace).cluster.apply(cluster => {
        const endpoint = requireBestEndpoint(connection.endpoints, cluster)

        return l4EndpointToString(endpoint)
      }),
      host: output(namespace).cluster.apply(cluster => {
        const endpoint = requireBestEndpoint(connection.endpoints, cluster)

        return l3EndpointToString(endpoint)
      }),
      port: output(namespace).cluster.apply(cluster => {
        const endpoint = requireBestEndpoint(connection.endpoints, cluster)

        return endpoint.port.toString()
      }),
      url: output(namespace).cluster.apply(cluster =>
        getPostgresqlConnectionUrl(connection, cluster),
      ),
    },
  })
}
