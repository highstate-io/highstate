import { Deployment, Namespace } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { images } from "../shared"

const { args, inputs, outputs } = forUnit(k8s.apps.portal)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

Deployment.create(args.appName, {
  namespace,

  container: {
    image: images.portal.image,

    port: {
      name: "http",
      containerPort: 8080,
    },
  },

  route: {
    type: "http",
    accessPoint: inputs.accessPoint,
    fqdn: args.fqdn,
  },
})

export default outputs({
  $statusFields: {
    url: `https://${args.fqdn}`,
  },
})
