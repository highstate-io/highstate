import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import charts from "../../../assets/charts.json"
import { Chart } from "../../helm"
import { Namespace } from "../../namespace"

const { args, inputs, outputs } = forUnit(k8s.certManager)

const namespace = Namespace.create("cert-manager", { cluster: inputs.k8sCluster })

new Chart("cert-manager", {
  namespace,

  chart: charts["cert-manager"],

  values: {
    crds: {
      enabled: true,
    },

    config: {
      apiVersion: "controller.config.cert-manager.io/v1alpha1",
      kind: "ControllerConfiguration",
      enableGatewayAPI: args.enableGatewayApi,
    },
  },
})

export default outputs({
  k8sCluster: inputs.k8sCluster,
})
