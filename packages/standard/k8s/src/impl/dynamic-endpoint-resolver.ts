import {
  dynamicEndpointResolverMediator,
  endpointToString,
  MaterializedFile,
  parseEndpoint,
  rebaseEndpoint,
} from "@highstate/common"
import { z } from "@highstate/contract"
import { k8s } from "@highstate/library"
import { isEndpointFromCluster } from "../service"
import spawn, { SubprocessError, type Subprocess } from "nano-spawn"
import { crc32 } from "node:zlib"

export const resolveDynamicEndpoint = dynamicEndpointResolverMediator.implement(
  z.object({ cluster: k8s.clusterEntity.schema }),
  async ({ endpoint }, { cluster }) => {
    if (!isEndpointFromCluster(endpoint, cluster)) {
      throw new Error(
        `Endpoint "${endpointToString(endpoint)}" is not from cluster "${cluster.id}"`,
      )
    }

    const { name, namespace } = endpoint.metadata["k8s.service"]

    const localPort = getStablePort(`${cluster.id}:${namespace}:${name}`)

    console.log(
      `[port-forward] starting port-forward for service "${name}" in namespace "${namespace}" on local port ${localPort}`,
    )

    let subprocess: Subprocess

    return {
      endpoint: rebaseEndpoint(endpoint, parseEndpoint(`localhost:${localPort}`)),

      setup: async () => {
        await using config = await MaterializedFile.create("kubeconfig", cluster.kubeconfig)

        subprocess = spawn("kubectl", [
          "--kubeconfig",
          config.path,
          "port-forward",
          `service/${name}`,
          "-n",
          namespace,
          `${localPort}:${endpoint.port}`,
        ])

        // catch the error when the process is killed to prevent unhandled promise rejection
        subprocess.catch(err => {
          if (err instanceof SubprocessError && err.signalName === "SIGTERM") {
            // correct termination
            return
          }

          throw err
        })

        const nodeProcess = await subprocess.nodeChildProcess

        await new Promise<void>((resolve, reject) => {
          nodeProcess.stdout?.once("data", (data: Buffer) => {
            const output = data.toString()

            if (output.includes("Forwarding from")) {
              resolve()
            } else {
              reject(new Error(`Failed to start port-forward: ${output}`))
            }
          })

          nodeProcess.stderr?.once("data", (data: Buffer) => {
            reject(new Error(`Failed to start port-forward: ${data.toString()}`))
          })
        })
      },

      dispose: async () => {
        console.log(
          `[port-forward] stopping port-forward for service "${name}" in namespace "${namespace}" on local port ${localPort}`,
        )

        const nodeProcess = await subprocess.nodeChildProcess
        nodeProcess.kill()
      },
    }
  },
)

/**
 * Return a stable port number based on the given id.
 * This is important because Pulumi stores the resolved endpoint in the state,
 * and uses it in destroy operations.
 */
function getStablePort(id: string): number {
  const hash = crc32(id)

  const minPort = 30000
  const maxPort = 60000

  return (Math.abs(hash) % (maxPort - minPort)) + minPort
}
