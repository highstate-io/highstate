import { readFile } from "node:fs/promises"
import {
  dynamicEndpointResolverMediator,
  endpointToString,
  MaterializedFile,
  parseEndpoint,
  rebaseEndpoint,
} from "@highstate/common"
import { getEntityId, z } from "@highstate/contract"
import { k8s } from "@highstate/library"
import { getHighstateRuntime } from "@highstate/pulumi"
import { isEndpointFromCluster } from "../service"
import { images } from "../shared"

export const resolveDynamicEndpoint = dynamicEndpointResolverMediator.implement(
  z.object({ cluster: k8s.clusterEntity.schema }),
  async ({ endpoint }, { cluster }) => {
    if (!isEndpointFromCluster(endpoint, cluster)) {
      throw new Error(
        `Endpoint "${endpointToString(endpoint)}" is not from cluster "${cluster.id}"`,
      )
    }

    const { name, namespace } = endpoint.metadata["k8s.service"]

    const config = MaterializedFile.for(cluster.kubeconfig)
    await using _ = await config.open()
    const kubeconfig = await readFile(config.path, "utf-8")

    const identity = getEntityId(endpoint)

    await getHighstateRuntime().sidecar.start({
      identity,
      image: images["terminal-kubectl"].image,
      command: ["bash", "-lc"],
      args: [
        [
          "set -euo pipefail",
          'kubectl --kubeconfig /highstate/kubeconfig port-forward --address "$HIGHSTATE_SIDECAR_IP" "service/$SERVICE_NAME" -n "$NAMESPACE" "$TARGET_PORT:$TARGET_PORT"',
        ].join("\n"),
      ],
      env: {
        NAMESPACE: namespace,
        SERVICE_NAME: name,
        TARGET_PORT: String(endpoint.port),
      },
      files: [
        {
          path: "/highstate/kubeconfig",
          content: kubeconfig,
          secret: true,
          mode: 0o600,
        },
      ],
      ports: [
        {
          name: "service",
          containerPort: endpoint.port,
          protocol: "tcp",
        },
      ],
      readiness: {
        type: "tcp",
        port: "service",
        timeoutSeconds: 30,
      },
    })

    return rebaseEndpoint(endpoint, parseEndpoint(`${identity}.highstate.local:${endpoint.port}`))
  },
)
