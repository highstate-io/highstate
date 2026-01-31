import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { yaml } from "@pulumi/kubernetes"
import { getProviderAsync } from "../../shared"

const { inputs, outputs } = forUnit(k8s.gatewayApi)

const provider = await getProviderAsync(inputs.k8sCluster)

new yaml.v2.ConfigFile(
  "gateway-api",
  {
    file: "https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.4.0/experimental-install.yaml",
  },
  { provider },
)

export default outputs({
  k8sCluster: inputs.k8sCluster,
})
