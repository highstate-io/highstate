import { l4EndpointToString } from "@highstate/common"
import { Deployment } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { map } from "remeda"
import { getObfuscatorComponents, images } from "../../shared"

const { name, args, inputs, outputs } = forUnit(k8s.obfuscators.phantun.obfuscator)

const { appName, namespace, bestEndpoint } = await getObfuscatorComponents(
  "phantun",
  name,
  args,
  inputs,
)

const deployment = Deployment.create(appName, {
  namespace,

  container: {
    image: images.phantun.image,

    args: [
      "phantun-client",
      "--local",
      "0.0.0.0:1234",
      "--remote",
      l4EndpointToString(bestEndpoint),
    ],

    port: {
      containerPort: 1234,
      protocol: "UDP",
    },

    allowedEndpoints: [bestEndpoint],
    enableTun: true,
  },

  service: {
    external: args.external,
  },
})

export default outputs({
  entryEndpoints: deployment.service.endpoints,

  $statusFields: {
    entryEndpoints: deployment.service.endpoints.apply(map(l4EndpointToString)),
  },

  $terminals: [deployment.terminal],
})
