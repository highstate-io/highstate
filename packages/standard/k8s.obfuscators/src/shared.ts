import type { k8s, network } from "@highstate/library"
import type { Input } from "@pulumi/pulumi"
import { parseL4Endpoint } from "@highstate/common"
import { Namespace, requireBestEndpoint } from "@highstate/k8s"
import { toPromise } from "@highstate/pulumi"
import * as images from "../assets/images.json"

type DeobfuscatorInputs = {
  k8sCluster: Input<k8s.Cluster>
  targetEndpoints: Input<network.L4Endpoint[]>
}

type ObfuscatorInputs = {
  k8sCluster: Input<k8s.Cluster>
  endpoints: Input<network.L4Endpoint[]>
}

export async function getDeobfuscatorComponents(
  type: string,
  name: string,
  args: k8s.obfuscators.DeobfuscatorArgs,
  inputs: DeobfuscatorInputs,
) {
  const appName = args.appName ?? `deobfs-${type}-${name.replaceAll(".", "-")}`
  const cluster = await toPromise(inputs.k8sCluster)

  const namespace = Namespace.create(appName, {
    cluster,
    privileged: true,
  })

  const resolvedTargetInputs = await toPromise(inputs.targetEndpoints)
  const targetEndpoints = [...args.targetEndpoints.map(parseL4Endpoint), ...resolvedTargetInputs]

  const bestTargetEndpoint = requireBestEndpoint(targetEndpoints, cluster)

  return { appName, namespace, targetEndpoints, bestTargetEndpoint }
}

export async function getObfuscatorComponents(
  type: string,
  name: string,
  args: k8s.obfuscators.ObfuscatorArgs,
  inputs: ObfuscatorInputs,
) {
  const appName = args.appName ?? `obfs-${type}-${name.replaceAll(".", "-")}`
  const cluster = await toPromise(inputs.k8sCluster)

  const namespace = Namespace.create(appName, {
    cluster,
    privileged: true,
  })

  const resolvedEndpoints = await toPromise(inputs.endpoints)
  const endpoints = [...args.endpoints.map(parseL4Endpoint), ...resolvedEndpoints]

  const bestEndpoint = requireBestEndpoint(endpoints, cluster)

  return { appName, namespace, endpoints, bestEndpoint }
}

export { images }
