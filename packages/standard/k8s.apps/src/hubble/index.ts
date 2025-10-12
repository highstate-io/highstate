import { AccessPointRoute } from "@highstate/common"
import { Namespace, Service } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"

const { args, inputs, outputs } = forUnit(k8s.apps.hubble)

const namespace = Namespace.get("kube-system", { name: "kube-system", cluster: inputs.k8sCluster })
const service = Service.get("hubble-ui", { namespace, name: "hubble-ui" })

new AccessPointRoute(args.appName, {
  type: "http",
  accessPoint: inputs.accessPoint,
  endpoints: service.endpoints,
  gatewayNativeData: service,
  tlsCertificateNativeData: namespace,
})

export default outputs({})
