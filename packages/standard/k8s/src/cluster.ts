import type { k8s } from "@highstate/library"
import { text, type UnitTerminal } from "@highstate/contract"
import { fileFromString, type Input, type Output, output } from "@highstate/pulumi"
import { CoreV1Api, type KubeConfig } from "@kubernetes/client-node"
import { images } from "./shared"

function isPrivateIp(ip: string) {
  const privateIpRegex = /^(10|172\.16|192\.168)\./
  return privateIpRegex.test(ip)
}

export async function detectExternalIps(
  kubeConfig: KubeConfig,
  internalIpsPolicy: k8s.InternalIpsPolicy,
): Promise<string[]> {
  const nodeApi = kubeConfig.makeApiClient(CoreV1Api)
  const nodes = await nodeApi.listNode()

  return nodes.items.flatMap(node => {
    const addresses = node.status?.addresses ?? []
    const externalIp = addresses.find(address => address.type === "ExternalIP")
    const internalIp = addresses.find(address => address.type === "InternalIP")

    const result: string[] = []

    if (externalIp?.address) {
      result.push(externalIp.address)
    }

    if (internalIp?.address && internalIpsPolicy === "always") {
      result.push(internalIp.address)
    }

    if (internalIp?.address && internalIpsPolicy === "public" && !isPrivateIp(internalIp.address)) {
      result.push(internalIp.address)
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
