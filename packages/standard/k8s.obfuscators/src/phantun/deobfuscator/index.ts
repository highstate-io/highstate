import { l4EndpointToString } from "@highstate/common"
import { Deployment } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { map } from "remeda"
import { getDeobfuscatorComponents, images } from "../../shared"

const { name, args, inputs, outputs } = forUnit(k8s.obfuscators.phantun.deobfuscator)

const { appName, namespace, bestTargetEndpoint } = await getDeobfuscatorComponents(
  "phantun",
  name,
  args,
  inputs,
)

const deployment = Deployment.create(appName, {
  namespace,

  container: {
    image: images.phantun.image,
    args: ["phantun-server", "--local", "4567", "--remote", l4EndpointToString(bestTargetEndpoint)],

    port: {
      containerPort: 4567,
      protocol: "TCP",
    },

    allowedEndpoints: [bestTargetEndpoint],
    enableTun: true,
  },

  service: {
    external: args.external,
  },
})

export default outputs({
  endpoints: deployment.service.endpoints,

  $statusFields: {
    endpoints: deployment.service.endpoints.apply(map(l4EndpointToString)),
  },

  $terminals: [deployment.terminal],
})
