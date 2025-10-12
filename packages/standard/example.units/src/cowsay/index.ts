import { text } from "@highstate/contract"
import { cowsay } from "@highstate/example.library"
import {
  createNamespace,
  createScriptContainer,
  Deployment,
  getProvider,
  ScriptBundle,
  useStandardAcessPoint,
} from "@highstate/k8s"
import { forUnit } from "@highstate/pulumi"

const { args, inputs } = forUnit(cowsay)

const provider = await getProvider(inputs.k8sCluster)
const namespace = createNamespace(args.appName, provider)

const { gateway } = await useStandardAcessPoint(namespace, args, inputs, provider)

const entrypoint = async () => {
  const { createServer } = await import("node:http")
  const { createApp, defineEventHandler, toNodeListener, setResponseHeader } = await import("h3")
  const { $ } = await import("zx")

  const app = createApp()

  const handler = defineEventHandler(async event => {
    setResponseHeader(event, "content-type", "text/plain; charset=utf-8")

    return await $`cowsay ${args.text}`.text()
  })

  app.use(handler)

  createServer(toNodeListener(app)).listen(3000)
}

const bundle = new ScriptBundle(
  args.appName,
  {
    distribution: "alpine",
    namespace,

    environment: {
      alpine: {
        preInstallScripts: {
          "add-testing-repo.sh": text`
            #!/bin/sh
            set -e

            echo "Adding testing repository..."
            echo "@testing https://dl-cdn.alpinelinux.org/alpine/edge/testing" >> /etc/apk/repositories
          `,
        },

        packages: ["cowsay@testing", "bash"],
      },

      files: {
        "hello.js": entrypoint,
      },
    },
  },
  { provider },
)

Deployment.create(
  args.appName,
  {
    cluster: inputs.k8sCluster,
    namespace,

    container: createScriptContainer({
      bundle,
      main: "hello.js",

      port: {
        containerPort: 3000,
        protocol: "TCP",
      },
    }),

    httpRoute: { gateway },
  },
  { provider },
)
