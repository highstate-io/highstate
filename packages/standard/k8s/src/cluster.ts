import type { k8s, network } from "@highstate/library"
import { isPrivateAddress, parseAddress } from "@highstate/common"
import { text, type UnitTerminal } from "@highstate/contract"
import { fileFromString, type Input, type Output, output } from "@highstate/pulumi"
import { CoreV1Api, type KubeConfig } from "@kubernetes/client-node"
import { images } from "./shared"

export async function detectExternalIps(
  kubeConfig: KubeConfig,
  internalIpsPolicy: k8s.InternalIpsPolicy,
): Promise<network.Address[]> {
  const nodeApi = kubeConfig.makeApiClient(CoreV1Api)
  const nodes = await nodeApi.listNode()

  return nodes.items.flatMap(node => {
    const addresses = node.status?.addresses ?? []

    const externalIp = addresses.find(address => address.type === "ExternalIP")
    const internalIp = addresses.find(address => address.type === "InternalIP")

    const externalAddress = externalIp ? parseAddress(externalIp.address) : undefined
    const internalAddress = internalIp ? parseAddress(internalIp.address) : undefined

    const result: network.Address[] = []

    if (externalAddress) {
      result.push(externalAddress)
    }

    if (internalAddress && internalIpsPolicy === "always") {
      result.push(internalAddress)
    }

    if (internalAddress && internalIpsPolicy === "public" && !isPrivateAddress(internalAddress)) {
      result.push(internalAddress)
    }

    return result
  })
}

export function createK8sTerminal(kubeconfig: Input<string>): Output<UnitTerminal> {
  return output({
    name: "management",

    meta: {
      title: "Cluster Management",
      description: "Manage the cluster using kubectl and helm",
      icon: "devicon:kubernetes",
    },

    spec: {
      image: images["terminal-kubectl"].image,
      command: ["bash", "/welcome.sh"],

      files: {
        "/kubeconfig": fileFromString("kubeconfig", kubeconfig, { isSecret: true }),

        "/welcome.sh": fileFromString(
          "welcome.sh",
          text`
            echo "Connecting to the cluster..."
            kubectl cluster-info

            echo "Use 'kubectl' and 'helm' to manage the cluster."
            echo

            exec bash
          `,
        ),
      },

      env: {
        KUBECONFIG: "/kubeconfig",
      },
    },
  })
}
