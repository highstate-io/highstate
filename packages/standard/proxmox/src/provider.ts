import type { proxmox } from "@highstate/library"
import { l7EndpointToString } from "@highstate/common"
import { type Input, output, toPromise } from "@highstate/pulumi"
import { Provider } from "@muhlba91/pulumi-proxmoxve"

export function createProvider(cluster: Input<proxmox.Cluster>): Promise<Provider> {
  return toPromise(
    output(cluster).apply(cluster => {
      return new Provider("proxmox", {
        endpoint: l7EndpointToString(cluster.endpoint),

        insecure: cluster.insecure,
        username: cluster.username,
        password: cluster.password,

        apiToken: cluster.apiToken,

        ssh: cluster.ssh
          ? {
              privateKey: cluster.ssh.keyPair?.privateKey,
              username: cluster.ssh.user,
              password: cluster.ssh.password,
            }
          : undefined,
      })
    }),
  )
}
