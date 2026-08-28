import type { types } from "@pulumi/kubernetes"
import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { endpointToString, MaterializedFolder, parseEndpoint } from "@highstate/common"
import { ConfigMap, Deployment, Namespace } from "@highstate/k8s"
import { type common, k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { images } from "../shared"

const { args, inputs, outputs } = forUnit(k8s.apps.wgFeedServer)

if (Boolean(args.pathPattern) !== Boolean(inputs.fallbackSite)) {
  throw new Error("pathPattern and fallbackSite must be provided together")
}

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const fallbackSiteVolume = inputs.fallbackSite
  ? await createFallbackSiteConfigMap(args.appName, namespace, inputs.fallbackSite)
  : undefined

Deployment.create(args.appName, {
  namespace,
  replicas: args.replicas,
  args: {
    scheduling: args.scheduling,
  },

  containers: [
    {
      name: "feed",
      image: images["wg-feed-server"].image,

      port: {
        name: "feed",
        containerPort: 8080,
      },

      environment: {
        ETCD_ENDPOINTS: inputs.etcd.endpoints.map(endpointToString).join(", "),
      },
    },
    ...(fallbackSiteVolume
      ? [
          {
            name: "fallback",
            image: images["static-file-server"].image,

            port: {
              name: "fallback",
              containerPort: 8081,
            },

            environment: {
              PORT: "8081",
            },

            volumeMount: {
              volume: fallbackSiteVolume,
              mountPath: "/web",
            },
          },
        ]
      : []),
  ],

  route: fallbackSiteVolume
    ? {
        type: "http",
        accessPoint: inputs.accessPoint,
        fqdn: args.fqdn,
        rules: {
          feed: {
            servicePort: "feed",
            path: {
              type: "RegularExpression",
              value: args.pathPattern!,
            },
          },
          fallback: {
            servicePort: "fallback",
          },
        },
      }
    : {
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

async function createFallbackSiteConfigMap(
  name: string,
  namespace: Namespace,
  site: common.Folder,
): Promise<types.input.core.v1.Volume> {
  const folder = MaterializedFolder.for(site, `${name}.fallback`)
  await using _ = await folder.open()
  const entries = await readdir(folder.path, { recursive: true, withFileTypes: true })
  const files = entries
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
    .sort()

  if (files.length === 0) {
    throw new Error("fallbackSite must contain at least one file")
  }

  const binaryData: Record<string, string> = {}
  const items: NonNullable<types.input.core.v1.ConfigMapVolumeSource["items"]> = []

  for (const [index, path] of files.entries()) {
    const key = `file-${index}`

    binaryData[key] = (await readFile(path)).toString("base64")
    items.push({ key, path: relative(folder.path, path) })
  }

  const configMap = ConfigMap.create(`${name}-fallback`, {
    namespace,
    binaryData,
  })

  return {
    name: `${name}-fallback`,
    configMap: {
      name: configMap.metadata.name,
      items,
    },
  }
}
