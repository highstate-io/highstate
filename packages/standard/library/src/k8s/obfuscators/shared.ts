import { $args, $inputs, $outputs, type FullComponentArgumentOptions, z } from "@highstate/contract"
import { l4EndpointEntity } from "../../network"
import { clusterEntity } from "../shared"

export const deobfuscatorSpec = {
  args: $args({
    /**
     * The name of the namespace and deployment to deploy the deobfuscator on.
     *
     * By default, calculated as `deobfs-{type}-{name}`.
     */
    appName: z.string().optional(),

    /**
     * The L4 endpoint to forward deobfuscated traffic to.
     *
     * Will take precedence over the `targetEndpoint` input.
     */
    targetEndpoints: z.string().array().default([]),

    /**
     * Whether to expose the deobfuscator service by "NodePort" or "LoadBalancer".
     *
     * By default, the service is not exposed and only accessible from within the cluster.
     */
    external: z.boolean().default(false),
  }),

  inputs: $inputs({
    /**
     * The Kubernetes cluster to deploy the deobfuscator on.
     */
    k8sCluster: clusterEntity,

    /**
     * The L4 endpoints to forward deobfuscated traffic to.
     *
     * Will select the most appropriate endpoint based on the environment.
     */
    targetEndpoints: {
      entity: l4EndpointEntity,
      required: false,
      multiple: true,
    },
  }),

  outputs: $outputs({
    /**
     * The L4 endpoints of the deobfuscator accepting obfuscated traffic.
     */
    endpoints: {
      entity: l4EndpointEntity,
      required: false,
      multiple: true,
    },
  }),
}

export const obfuscatorSpec = {
  args: $args({
    /**
     * The name of the namespace and deployment to deploy the obfuscator on.
     *
     * By default, calculated as `obfs-{type}-{name}`.
     */
    appName: z.string().optional(),

    /**
     * The endpoint of the deobfuscator to pass obfuscated traffic to.
     *
     * Will take precedence over the `endpoint` input.
     */
    endpoints: z.string().array().default([]),

    /**
     * Whether to expose the obfuscator service by "NodePort" or "LoadBalancer".
     *
     * By default, the service is not exposed and only accessible from within the cluster.
     */
    external: z.boolean().default(false),
  }),

  inputs: $inputs({
    /**
     * The Kubernetes cluster to deploy the obfuscator on.
     */
    k8sCluster: clusterEntity,

    /**
     * The L4 endpoints of the deobfuscator to pass obfuscated traffic to.
     *
     * Will select the most appropriate endpoint based on the environment.
     */
    endpoints: {
      entity: l4EndpointEntity,
      required: false,
      multiple: true,
    },
  }),

  outputs: $outputs({
    /**
     * The L4 endpoints accepting unobfuscated traffic.
     */
    entryEndpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  }),
}

type ArgsFromSpec<T extends Record<string, FullComponentArgumentOptions>> = z.infer<
  z.ZodObject<{
    [K in keyof T]: T[K]["schema"]
  }>
>

export type DeobfuscatorArgs = ArgsFromSpec<typeof deobfuscatorSpec.args>
export type ObfuscatorArgs = ArgsFromSpec<typeof obfuscatorSpec.args>
