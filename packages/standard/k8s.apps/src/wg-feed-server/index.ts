import { endpointToString, parseEndpoint } from "@highstate/common"
import { Deployment, Namespace } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { join, map } from "remeda"
import { images } from "../shared"

const { args, inputs, outputs } = forUnit(k8s.apps.wgFeedServer)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

Deployment.create(args.appName, {
  namespace,

  container: {
    image: images["wg-feed-server"].image,

    port: {
      name: "http",
      containerPort: 8080,
    },

    environment: {
      ETCD_ENDPOINTS: inputs.etcd.endpoints.apply(map(endpointToString)).apply(join(", ")),
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
  // TODO: infer endpoint from deployment
  endpoint: parseEndpoint(`https://${args.fqdn}:443`, 4),
})
