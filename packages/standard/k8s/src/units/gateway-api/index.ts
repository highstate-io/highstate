import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { yaml } from "@pulumi/kubernetes"
import { getProviderAsync } from "../../shared"

const { args, inputs, outputs } = forUnit(k8s.gatewayApi)

const provider = await getProviderAsync(inputs.k8sCluster)
const version = args.version ?? getDefaultVersion(args.channel)
const manifestName = args.channel === "stable" ? "standard-install" : "experimental-install"

new yaml.v2.ConfigFile(
  "gateway-api",
  {
    file: `https://github.com/kubernetes-sigs/gateway-api/releases/download/v${version}/${manifestName}.yaml`,
  },
  { provider },
)

export default outputs({
  k8sCluster: inputs.k8sCluster,
})

function getDefaultVersion(channel: "stable" | "experimental"): string {
  if (channel === "experimental") {
    throw new Error("Gateway API version must be specified when using the experimental channel.")
  }

  return "1.6.0"
}
