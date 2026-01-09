import type { k8s, network } from "@highstate/library"
import type { Namespace } from "./namespace"
import {
  ImplementationMediator,
  type InputEndpoint,
  l3EndpointToCidr,
  endpointToString,
  parseL34Endpoint,
} from "@highstate/common"
import { z } from "@highstate/contract"
import {
  ComponentResource,
  type Input,
  type InputArray,
  interpolate,
  normalize,
  type Output,
  output,
  type Resource,
  type ResourceOptions,
  toPromise,
  type Unwrap,
} from "@highstate/pulumi"
import { type core, networking, type types } from "@pulumi/kubernetes"
import { flat, groupBy, merge, mergeDeep, uniqueBy } from "remeda"
import { requireBestEndpoint } from "./network"
import { isEndpointFromCluster, mapServiceToLabelSelector } from "./service"
import {
  getNamespaceName,
  getProviderAsync,
  mapMetadata,
  mapNamespaceNameToSelector,
  mapSelectorLikeToSelector,
  type NamespaceLike,
  type ScopedResourceArgs,
  type SelectorLike,
} from "./shared"

export type NetworkPolicyPort = {
  /**
   * The protocol to match.
   *
   * If not provided, "TCP" will be used.
   */
  protocol?: string
} & (
  | {
      /**
       * The single port to match.
       */
      port: number | string
    }
  | {
      /**
       * The range of ports to match.
       */
      range: [start: number, end: number]
    }
)

export type IngressRuleArgs = {
  /**
   * Whether to allow all incoming traffic.
   *
   * If set to `true`, all other rules will be ignored for matched traffic.
   */
  fromAll?: Input<boolean>

  /**
   * The allowed cidr for incoming traffic.
   *
   * Will be ORed with other conditions inside the same rule (except ports).
   */
  fromCidr?: Input<string>

  /**
   * The list of allowed cidrs for incoming traffic.
   *
   * Will be ORed with other conditions inside the same rule (except ports).
   */
  fromCidrs?: InputArray<string>

  /**
   * The list of allowed L3 or L4 endpoints for outgoing traffic.
   *
   * Just a syntactic sugar for `fromFqdn` and `fromService` for cases when the endpoint can be one of them + optional port/protocol.
   *
   * Will be ORed with other conditions inside the same rule (except ports).
   *
   * If a single endpoint also has a port/protocol/service metadata,
   * it will produce separate rule for it with them and ORed with the rest of the rules.
   */
  fromEndpoint?: Input<InputEndpoint>

  /**
   * The list of allowed L3 or L4 endpoints for incoming traffic.
   *
   * Just a syntactic sugar for `fromFqdn` and `fromService` for cases when the endpoint can be one of them + optional port/protocol.
   *
   * Will be ORed with other conditions inside the same rule (except ports).
   *
   * If a single endpoint also has a port/protocol/service metadata,
   * it will produce separate rule for it with them and ORed with the rest of the rules.
   */
  fromEndpoints?: InputArray<InputEndpoint>

  /**
   * The service to allow traffic from.
   *
   * Will be ORed with other conditions inside the same rule (except ports).
   */
  fromService?: Input<core.v1.Service>

  /**
   * The list of allowed services for incoming traffic.
   *
   * Will be ORed with other conditions inside the same rule (except ports).
   */
  fromServices?: InputArray<core.v1.Service>

  /**
   * The namespace to allow traffic from.
   *
   * If provided with `fromSelector(s)`, it will be ANDed with them.
   * Otherwise, it will match all pods in the namespace.
   *
   * Will be ORed with other conditions inside the same rule (except ports and selectors).
   */
  fromNamespace?: Input<NamespaceLike>

  /**
   * The list of allowed namespaces for incoming traffic.
   *
   * If provided with `fromSelector(s)`, it will be ANDed with them.
   * Otherwise, it will match all pods in the namespaces.
   *
   * Will be ORed with other conditions inside the same rule (except ports and selectors).
   */
  fromNamespaces?: InputArray<NamespaceLike>

  /**
   * The selector for incoming traffic.
   *
   * If provided with `fromNamespace(s)`, it will be ANDed with them.
   * Otherwise, it will match pods in all namespaces.
   *
   * Will be ORed with other conditions inside the same rule (except ports and namespaces).
   */
  fromSelector?: Input<SelectorLike>

  /**
   * The list of selectors for incoming traffic.
   *
   * If provided with `fromNamespace(s)`, it will be ANDed with them.
   * Otherwise, it will match pods in all namespaces.
   *
   * Will be ORed with other conditions inside the same rule (except ports and namespaces).
   */
  fromSelectors?: InputArray<SelectorLike>

  /**
   * The port to allow incoming traffic on.
   *
   * Will be ANDed with all conditions inside the same rule.
   */
  toPort?: Input<NetworkPolicyPort>

  /**
   * The list of allowed ports for incoming traffic.
   *
   * Will be ANDed with all conditions inside the same rule.
   */
  toPorts?: InputArray<NetworkPolicyPort>
}

export type EgressRuleArgs = {
  /**
   * Whether to allow all outgoing traffic.
   *
   * If set to `true`, all other rules will be ignored for matched traffic.
   */
  toAll?: Input<boolean>

  /**
   * The allowed cidr for outgoing traffic.
   *
   * Will be ORed with other conditions inside the same rule (except ports).
   */
  toCidr?: Input<string>

  /**
   * The list of allowed cidrs for outgoing traffic.
   *
   * Will be ORed with other conditions inside the same rule (except ports).
   */
  toCidrs?: InputArray<string>

  /**
   * The FQDN to allow outgoing traffic.
   *
   * Will be ORed with other conditions inside the same rule (except ports).
   */
  toFqdn?: Input<string>

  /**
   * The list of allowed FQDNs for outgoing traffic.
   *
   * Will be ORed with other conditions inside the same rule (except ports).
   */
  toFqdns?: InputArray<string>

  /**
   * The L3 or L4 endpoint to allow outgoing traffic.
   *
   * Just a syntactic sugar for `toFqdn`, `toCidr` and `toService` for cases when the endpoint can be one of them + optional port/protocol.
   *
   * Will be ORed with other conditions inside the same rule (except ports).
   *
   * If a single endpoint also has a port/protocol/service metadata,
   * it will produce separate rule for it with them and ORed with the rest of the rules.
   */
  toEndpoint?: Input<InputEndpoint>

  /**
   * The list of allowed L3 or L4 endpoints for outgoing traffic.
   *
   * Just a syntactic sugar for `toFqdn`, `toCidr` and `toService` for cases when the endpoint can be one of them + optional port/protocol.
   *
   * Will be ORed with other conditions inside the same rule (except ports).
   *
   * If a single endpoint also has a port/protocol/service metadata,
   * it will produce separate rule for it with them and ORed with the rest of the rules.
   */
  toEndpoints?: InputArray<InputEndpoint>

  /**
   * The service to allow traffic to.
   *
   * Will be ORed with other conditions inside the same rule (except ports).
   */
  toService?: Input<core.v1.Service>

  /**
   * The list of allowed services for outgoing traffic.
   *
   * Will be ORed with other conditions inside the same rule (except ports).
   */
  toServices?: InputArray<core.v1.Service>

  /**
   * The namespace to allow traffic to.
   *
   * If provided with `toSelector(s)`, it will be ANDed with them.
   * Otherwise, it will match all pods in the namespace.
   *
   * Will be ORed with other conditions inside the same rule (except ports and selectors).
   */
  toNamespace?: Input<NamespaceLike>

  /**
   * The list of allowed namespaces for outgoing traffic.
   *
   * If provided with `toSelector(s)`, it will be ANDed with them.
   * Otherwise, it will match all pods in the namespaces.
   *
   * Will be ORed with other conditions inside the same rule (except ports and selectors).
   */
  toNamespaces?: InputArray<NamespaceLike>

  /**
   * The selector for outgoing traffic.
   *
   * If provided with `toNamespace(s)`, it will be ANDe with them.
   *
   * Otherwise, it will match pods only in all namespaces.
   */
  toSelector?: Input<SelectorLike>

  /**
   * The list of selectors for outgoing traffic.
   *
   * If provided with `toNamespace(s)`, it will be ANDed with them.
   * Otherwise, it will match pods only in all namespaces.
   */
  toSelectors?: InputArray<SelectorLike>

  /**
   * The port to allow outgoing traffic on.
   *
   * Will be ANDed with all conditions inside the same rule.
   */
  toPort?: Input<NetworkPolicyPort>

  /**
   * The list of allowed ports for outgoing traffic.
   *
   * Will be ANDed with all conditions inside the same rule.
   */
  toPorts?: InputArray<NetworkPolicyPort>
}

export type NetworkPolicyArgs = ScopedResourceArgs & {
  /**
   * The description of this network policy.
   */
  description?: Input<string>

  /**
   * The pod selector for this network policy.
   * If not provided, it will select all pods in the namespace.
   */
  selector?: SelectorLike

  /**
   * The rule for incoming traffic.
   */
  ingressRule?: Input<IngressRuleArgs>

  /**
   * The rules for incoming traffic.
   */
  ingressRules?: InputArray<IngressRuleArgs>

  /**
   * The rule for outgoing traffic.
   */
  egressRule?: Input<EgressRuleArgs>

  /**
   * The rules for outgoing traffic.
   */
  egressRules?: InputArray<EgressRuleArgs>

  /**
   * Enable the isolation of ingress traffic, so that only matched traffic can ingress.
   */
  isolateIngress?: Input<boolean>

  /**
   * Enable the isolation of egress traffic, so that only matched traffic can egress.
   */
  isolateEgress?: Input<boolean>

  /**
   * Allow the eggress traffic to the API server of the cluster.
   *
   * By default, `false`.
   */
  allowKubeApiServer?: Input<boolean>

  /**
   * Allow the eggress traffic to the DNS server of the cluster.
   *
   * By default, `false`.
   */
  allowKubeDns?: Input<boolean>
}

export type NormalizedRuleArgs = {
  all: boolean
  cidrs: string[]
  fqdns: string[]
  services: core.v1.Service[]
  namespaces: NamespaceLike[]
  selectors: SelectorLike[]
  ports: NetworkPolicyPort[]
}

export type NormalizedNetworkPolicyArgs = Omit<
  Unwrap<NetworkPolicyArgs>,
  | "podSelector"
  | "ingressRule"
  | "ingressRules"
  | "egressRule"
  | "egressRules"
  | "isolateIngress"
  | "isolateEgress"
  | "allowKubeApiServer"
  | "allowKubeDNS"
> & {
  cluster: k8s.Cluster
  podSelector: Unwrap<types.input.meta.v1.LabelSelector>

  isolateIngress: boolean
  isolateEgress: boolean

  allowKubeApiServer: boolean

  ingressRules: NormalizedRuleArgs[]
  egressRules: NormalizedRuleArgs[]
}

export const networkPolicyMediator = new ImplementationMediator(
  "network-policy",
  z.object({ name: z.string(), args: z.custom<NormalizedNetworkPolicyArgs>() }),
  z.instanceof(ComponentResource),
)

/**
 * The resource for creating network policies.
 * Will use different resources depending on the cluster configuration.
 *
 * Note: In the worst case, it will create native `NetworkPolicy` resources and ignore some features like L7 rules.
 */
export class NetworkPolicy extends ComponentResource {
  /**
   * The underlying network policy resource.
   */
  public readonly networkPolicy: Output<Resource>

  constructor(name: string, args: NetworkPolicyArgs, opts?: ResourceOptions) {
    super("k8s:network-policy", name, args, opts)

    const normalizedArgs = output(args).apply(async args => {
      const ingressRules = normalize(args.ingressRule, args.ingressRules)
      const egressRules = normalize(args.egressRule, args.egressRules)
      const cluster = await toPromise(args.namespace.cluster)

      const extraEgressRules: NormalizedRuleArgs[] = []

      if (args.allowKubeDns) {
        extraEgressRules.push({
          namespaces: ["kube-system"],
          selectors: [{ matchLabels: { "k8s-app": "kube-dns" } }],
          ports: [{ port: 53, protocol: "UDP" }],
          all: false,
          cidrs: [],
          fqdns: [],
          services: [],
        })
      }

      return {
        ...args,

        podSelector: args.selector ? mapSelectorLikeToSelector(args.selector) : {},
        cluster,

        isolateEgress: args.isolateEgress ?? false,
        isolateIngress: args.isolateIngress ?? false,

        allowKubeApiServer: args.allowKubeApiServer ?? false,

        ingressRules: ingressRules.flatMap(rule => {
          const endpoints = normalize(rule?.fromEndpoint, rule?.fromEndpoints)
          const parsedEndpoints = endpoints.map(parseL34Endpoint)

          const endpointsNamespaces = groupBy(parsedEndpoints, endpoint => {
            const namespace = isEndpointFromCluster(endpoint, cluster)
              ? endpoint.metadata["k8s.service"].namespace
              : ""

            return namespace
          })

          const l3OnlyRule = endpointsNamespaces[""]
            ? NetworkPolicy.getRuleFromEndpoint(undefined, endpointsNamespaces[""], cluster)
            : undefined

          const otherRules = Object.entries(endpointsNamespaces)
            .filter(([key]) => key !== "")
            .map(([, endpoints]) => {
              return NetworkPolicy.getRuleFromEndpoint(undefined, endpoints, cluster)
            })

          return [
            {
              all: rule.fromAll ?? false,
              cidrs: normalize(rule.fromCidr, rule.fromCidrs).concat(l3OnlyRule?.cidrs ?? []),
              fqdns: [],
              services: normalize(rule.fromService, rule.fromServices),
              namespaces: normalize(rule.fromNamespace, rule.fromNamespaces),
              selectors: normalize(rule.fromSelector, rule.fromSelectors),
              ports: normalize(rule.toPort, rule.toPorts),
            } as NormalizedRuleArgs,

            ...otherRules,
          ].filter(rule => !NetworkPolicy.isEmptyRule(rule))
        }),

        egressRules: egressRules
          .flatMap(rule => {
            const endpoints = normalize(rule?.toEndpoint, rule?.toEndpoints)
            const parsedEndpoints = endpoints.map(parseL34Endpoint)

            const endpointsByPortsAnsNamespaces = groupBy(parsedEndpoints, endpoint => {
              const namespace = isEndpointFromCluster(endpoint, cluster)
                ? endpoint.metadata["k8s.service"].namespace
                : ""

              const port = isEndpointFromCluster(endpoint, cluster)
                ? endpoint.metadata["k8s.service"].targetPort
                : endpoint.port

              return `${port ?? "0"}:${namespace}`
            })

            const l3OnlyRule = endpointsByPortsAnsNamespaces["0:"]
              ? NetworkPolicy.getRuleFromEndpoint(
                  undefined,
                  endpointsByPortsAnsNamespaces["0:"],
                  cluster,
                )
              : undefined

            const otherRules = Object.entries(endpointsByPortsAnsNamespaces)
              .filter(([key]) => key !== "0:")
              .map(([key, endpoints]) => {
                const [port] = key.split(":")
                const portNumber = parseInt(port, 10)
                const portValue = Number.isNaN(portNumber) ? port : portNumber

                return NetworkPolicy.getRuleFromEndpoint(portValue, endpoints, cluster)
              })

            return [
              {
                all: rule.toAll ?? false,
                cidrs: normalize(rule.toCidr, rule.toCidrs).concat(l3OnlyRule?.cidrs ?? []),
                fqdns: normalize(rule.toFqdn, rule.toFqdns).concat(l3OnlyRule?.fqdns ?? []),
                services: normalize(rule.toService, rule.toServices),
                namespaces: normalize(rule.toNamespace, rule.toNamespaces),
                selectors: normalize(rule.toSelector, rule.toSelectors),
                ports: normalize(rule.toPort, rule.toPorts),
              } as NormalizedRuleArgs,

              ...otherRules,
            ].filter(rule => !NetworkPolicy.isEmptyRule(rule))
          })
          .concat(extraEgressRules),
      }
    })

    this.networkPolicy = output(
      normalizedArgs.apply(async args => {
        const cluster = args.cluster

        // Check if cluster has a custom network policy implementation
        if (cluster.networkPolicyImplRef) {
          return networkPolicyMediator.call(cluster.networkPolicyImplRef, {
            name,
            args: args as NormalizedNetworkPolicyArgs,
          })
        }

        // Fallback to native network policy
        const nativePolicy = new NativeNetworkPolicy(name, args as NormalizedNetworkPolicyArgs, {
          ...opts,
          parent: this,
          provider: await getProviderAsync(output(args.namespace).cluster),
        })
        return nativePolicy.networkPolicy
      }),
    )
  }

  private static mapCidrFromEndpoint(
    this: void,
    result: network.L3Endpoint & { type: "ipv4" | "ipv6" },
  ): string {
    if (result.type === "ipv4") {
      return `${result.address}/32`
    }

    return `${result.address}/128`
  }

  private static getRuleFromEndpoint(
    port: number | string | undefined,
    endpoints: network.L34Endpoint[],
    cluster: k8s.Cluster,
  ): NormalizedRuleArgs {
    const ports: NetworkPolicyPort[] = port
      ? [{ port, protocol: endpoints[0].protocol?.toUpperCase() }]
      : []

    const cidrs = endpoints
      .filter(endpoint => !isEndpointFromCluster(endpoint, cluster))
      .filter(endpoint => endpoint.type === "ipv4" || endpoint.type === "ipv6")
      .map(NetworkPolicy.mapCidrFromEndpoint)

    const fqdns = endpoints
      .filter(endpoint => endpoint.type === "hostname")
      .map(endpoint => endpoint.hostname)

    const selectors = endpoints
      .filter(endpoint => isEndpointFromCluster(endpoint, cluster))
      .map(endpoint => endpoint.metadata["k8s.service"].selector)

    const namespace = endpoints
      .filter(endpoint => isEndpointFromCluster(endpoint, cluster))
      .map(endpoint => endpoint.metadata["k8s.service"].namespace)[0]

    return {
      all: false,
      cidrs,
      fqdns,
      services: [],
      namespaces: namespace ? [namespace] : [],
      selectors,
      ports,
    }
  }

  private static isEmptyRule(rule: NormalizedRuleArgs): boolean {
    return (
      !rule.all &&
      rule.cidrs.length === 0 &&
      rule.fqdns.length === 0 &&
      rule.services.length === 0 &&
      rule.namespaces.length === 0 &&
      rule.selectors.length === 0 &&
      rule.ports.length === 0
    )
  }

  /**
   * Creates network policy to isolate the namespace by denying all traffic to/from it.
   *
   * Automatically names the policy as: `isolate-namespace.{clusterName}.{namespace}.{clusterId}`.
   *
   * @param namespace The namespace to isolate.
   * @param opts Optional resource options.
   */
  static async isolateNamespace(
    namespace: Input<Namespace>,
    opts?: ResourceOptions,
  ): Promise<NetworkPolicy> {
    const name = await toPromise(output(namespace).metadata.name)
    const cluster = await toPromise(output(namespace).cluster)

    return new NetworkPolicy(
      `isolate-namespace.${cluster.name}.${name}.${cluster.id}`,
      {
        namespace,

        description: "By default, deny all traffic to/from the namespace.",

        isolateEgress: true,
        isolateIngress: true,
      },
      opts,
    )
  }

  /**
   * Creates network policy to allow all traffic inside the namespace (pod to pod within same namespace).
   *
   * Automatically names the policy as: `allow-inside-namespace.{clusterName}.{namespace}.{clusterId}`.
   *
   * @param namespace The namespace to create the policy in.
   * @param opts Optional resource options.
   */
  static async allowInsideNamespace(
    namespace: Input<Namespace>,
    opts?: ResourceOptions,
  ): Promise<NetworkPolicy> {
    const nsName = await toPromise(output(namespace).metadata.name)
    const cluster = await toPromise(output(namespace).cluster)

    return new NetworkPolicy(
      `allow-inside-namespace.${cluster.name}.${nsName}.${cluster.id}`,
      {
        namespace,
        description: "Allow all traffic inside the namespace.",
        ingressRule: { fromNamespace: namespace },
        egressRule: { toNamespace: namespace },
      },
      opts,
    )
  }

  /**
   * Creates network policy to allow traffic from the namespace to the Kubernetes API server.
   *
   * Automatically names the policy as: `allow-kube-api-server.{clusterName}.{namespace}.{clusterId}`.
   *
   * @param namespace The namespace to create the policy in.
   * @param opts Optional resource options.
   */
  static async allowKubeApiServer(
    namespace: Input<Namespace>,
    opts?: ResourceOptions,
  ): Promise<NetworkPolicy> {
    const nsName = await toPromise(output(namespace).metadata.name)
    const cluster = await toPromise(output(namespace).cluster)

    return new NetworkPolicy(
      `allow-kube-api-server.${cluster.name}.${nsName}.${cluster.id}`,
      {
        namespace,
        description: "Allow all traffic to the Kubernetes API server from the namespace.",
        allowKubeApiServer: true,
      },
      opts,
    )
  }

  /**
   * Creates network policy to allow egress DNS traffic (UDP 53) required for name resolution.
   *
   * Automatically names the policy as: `allow-kube-dns.{clusterName}.{namespace}.{clusterId}`.
   *
   * @param namespace The namespace to create the policy in.
   * @param opts Optional resource options.
   */
  static async allowKubeDns(
    namespace: Input<Namespace>,
    opts?: ResourceOptions,
  ): Promise<NetworkPolicy> {
    const nsName = await toPromise(output(namespace).metadata.name)
    const cluster = await toPromise(output(namespace).cluster)

    return new NetworkPolicy(
      `allow-kube-dns.${cluster.name}.${nsName}.${cluster.id}`,
      {
        namespace,
        description: "Allow all traffic to the Kubernetes DNS server from the namespace.",
        allowKubeDns: true,
      },
      opts,
    )
  }

  /**
   * Creates network policy to allow all egress traffic from the namespace.
   *
   * Automatically names the policy as: `allow-all-egress.{clusterName}.{namespace}.{clusterId}`.
   *
   * @param namespace The namespace to create the policy in.
   * @param opts Optional resource options.
   */
  static async allowAllEgress(
    namespace: Input<Namespace>,
    opts?: ResourceOptions,
  ): Promise<NetworkPolicy> {
    const nsName = await toPromise(output(namespace).metadata.name)
    const cluster = await toPromise(output(namespace).cluster)

    return new NetworkPolicy(
      `allow-all-egress.${cluster.name}.${nsName}.${cluster.id}`,
      {
        namespace,
        description: "Allow all egress traffic from the namespace.",
        egressRule: { toAll: true },
      },
      opts,
    )
  }

  /**
   * Creates network policy to allow all ingress traffic to the namespace.
   *
   * Automatically names the policy as: `allow-all-ingress.{clusterName}.{namespace}.{clusterId}`.
   *
   * @param namespace The namespace to create the policy in.
   * @param opts Optional resource options.
   */
  static async allowAllIngress(
    namespace: Input<Namespace>,
    opts?: ResourceOptions,
  ): Promise<NetworkPolicy> {
    const nsName = await toPromise(output(namespace).metadata.name)
    const cluster = await toPromise(output(namespace).cluster)
    return new NetworkPolicy(
      `allow-all-ingress.${cluster.name}.${nsName}.${cluster.id}`,
      {
        namespace,
        description: "Allow all ingress traffic to the namespace.",
        ingressRule: { fromAll: true },
      },
      opts,
    )
  }

  /**
   * Creates network policy to allow egress traffic to a specific L3/L4 endpoint.
   *
   * Automatically names the policy as: `allow-egress-to-<endpoint>.{clusterName}.{namespace}.{clusterId}`.
   *
   * @param namespace The namespace to create the policy in.
   * @param endpoint The endpoint to allow egress to.
   * @param opts Optional resource options.
   */
  static async allowEgressToEndpoint(
    namespace: Input<Namespace>,
    endpoint: InputEndpoint,
    opts?: ResourceOptions,
  ): Promise<NetworkPolicy> {
    const parsedEndpoint = parseL34Endpoint(endpoint)
    const endpointStr = endpointToString(parsedEndpoint).replace(/:/g, "-")
    const nsName = await toPromise(output(namespace).metadata.name)
    const cluster = await toPromise(output(namespace).cluster)

    return new NetworkPolicy(
      `allow-egress-to-${endpointStr}.${cluster.name}.${nsName}.${cluster.id}`,
      {
        namespace,
        description: `Allow egress traffic to "${endpointToString(parsedEndpoint)}" from the namespace.`,
        egressRule: { toEndpoint: endpoint },
      },
      opts,
    )
  }

  /**
   * Creates network policy to allow egress traffic to the best endpoint among provided candidates.
   *
   * Automatically names the policy as: `allow-egress-to-<bestEndpoint>.{clusterName}.{namespace}.{clusterId}`.
   *
   * @param namespace The namespace to create the policy in.
   * @param endpoints The candidate endpoints to select from.
   * @param opts Optional resource options.
   */
  static async allowEgressToBestEndpoint(
    namespace: Input<Namespace>,
    endpoints: InputArray<InputEndpoint>,
    opts?: ResourceOptions,
  ): Promise<NetworkPolicy> {
    const cluster = await toPromise(output(namespace).cluster)
    const resolvedEndpoints = await toPromise(output(endpoints))
    const bestEndpoint = requireBestEndpoint(resolvedEndpoints.map(parseL34Endpoint), cluster)

    return await NetworkPolicy.allowEgressToEndpoint(namespace, bestEndpoint, opts)
  }

  /**
   * Creates network policy to allow ingress traffic from a specific L3/L4 endpoint.
   *
   * Automatically names the policy as: `allow-ingress-from-<endpoint>.{clusterName}.{namespace}.{clusterId}`.
   *
   * @param namespace The namespace to create the policy in.
   * @param endpoint The endpoint to allow ingress from.
   * @param opts Optional resource options.
   */
  static async allowIngressFromEndpoint(
    namespace: Input<Namespace>,
    endpoint: InputEndpoint,
    opts?: ResourceOptions,
  ): Promise<NetworkPolicy> {
    const parsedEndpoint = parseL34Endpoint(endpoint)
    const endpointStr = endpointToString(parsedEndpoint).replace(/:/g, "-")
    const nsName = await toPromise(output(namespace).metadata.name)
    const cluster = await toPromise(output(namespace).cluster)

    return new NetworkPolicy(
      `allow-ingress-from-${endpointStr}.${cluster.name}.${nsName}.${cluster.id}`,
      {
        namespace,
        description: interpolate`Allow ingress traffic from "${endpointToString(parsedEndpoint)}" to the namespace.`,
        ingressRule: { fromEndpoint: endpoint },
      },
      opts,
    )
  }
}

export class NativeNetworkPolicy extends ComponentResource {
  /**
   * The underlying native network policy resource.
   */
  public readonly networkPolicy: Resource

  constructor(name: string, args: NormalizedNetworkPolicyArgs, opts?: ResourceOptions) {
    super("k8s:native-network-policy", name, args, opts)

    const ingress = NativeNetworkPolicy.createIngressRules(args)
    const egress = NativeNetworkPolicy.createEgressRules(args)

    const policyTypes: string[] = []

    if (ingress.length > 0 || args.isolateIngress) {
      policyTypes.push("Ingress")
    }

    if (egress.length > 0 || args.isolateEgress) {
      policyTypes.push("Egress")
    }

    this.networkPolicy = new networking.v1.NetworkPolicy(
      name,
      {
        metadata: mergeDeep(mapMetadata(args, name), {
          annotations: args.description
            ? { "kubernetes.io/description": args.description }
            : undefined,
        }),
        spec: {
          podSelector: args.podSelector,
          ingress,
          egress,
          policyTypes,
        },
      },
      { ...opts, parent: this },
    )
  }

  private static fallbackIpBlock: types.input.networking.v1.IPBlock = {
    cidr: "0.0.0.0/0",
    except: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
  }

  private static fallbackDnsRule: types.input.networking.v1.NetworkPolicyEgressRule = {
    to: [
      {
        namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } },
        podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
      },
    ],
    ports: [{ port: 53, protocol: "UDP" }],
  }

  private static createIngressRules(
    args: NormalizedNetworkPolicyArgs,
  ): types.input.networking.v1.NetworkPolicyIngressRule[] {
    return uniqueBy(
      args.ingressRules.map(rule => ({
        from: rule.all ? [] : NativeNetworkPolicy.createRulePeers(rule),
        ports: NativeNetworkPolicy.mapPorts(rule.ports),
      })),
      rule => JSON.stringify(rule),
    )
  }

  private static createEgressRules(
    args: NormalizedNetworkPolicyArgs,
  ): types.input.networking.v1.NetworkPolicyEgressRule[] {
    const extraRules: types.input.networking.v1.NetworkPolicyEgressRule[] = []

    const needKubeDns = args.egressRules.some(rule => rule.fqdns.length > 0)
    if (needKubeDns) {
      extraRules.push(NativeNetworkPolicy.fallbackDnsRule)
    }

    // the native resource does not support FQDNs
    // to provide compatibility, we need to fallback to all except private CIDRs
    const needFallback = args.egressRules.some(rule =>
      rule.fqdns.some(fqdn => !fqdn.endsWith(".cluster.local")),
    )
    if (needFallback) {
      extraRules.push({ to: [{ ipBlock: NativeNetworkPolicy.fallbackIpBlock }] })
    }

    // apply fallback rules for kube-apiserver
    if (args.allowKubeApiServer) {
      const { quirks, apiEndpoints } = args.cluster

      if (quirks?.fallbackKubeApiAccess) {
        extraRules.push({
          to: [{ ipBlock: { cidr: `${quirks?.fallbackKubeApiAccess.serverIp}/32` } }],
          ports: [{ port: quirks?.fallbackKubeApiAccess.serverPort, protocol: "TCP" }],
        })
      } else {
        const rules = apiEndpoints
          .filter(endpoint => endpoint.type !== "hostname")
          .map(endpoint => ({
            to: [{ ipBlock: { cidr: l3EndpointToCidr(endpoint) } }],
            ports: [{ port: endpoint.port, protocol: "TCP" }],
          }))

        extraRules.push(...rules)
      }
    }

    return uniqueBy(
      args.egressRules
        .map(rule => {
          return {
            to: rule.all ? [] : NativeNetworkPolicy.createRulePeers(rule),
            ports: NativeNetworkPolicy.mapPorts(rule.ports),
          } as types.input.networking.v1.NetworkPolicyEgressRule
        })
        .filter(rule => rule.to !== undefined)
        .concat(extraRules),
      rule => JSON.stringify(rule),
    )
  }

  private static createRulePeers(
    this: void,
    args: NormalizedRuleArgs,
  ): types.input.networking.v1.NetworkPolicyPeer[] | undefined {
    const peers = uniqueBy(
      [
        ...NativeNetworkPolicy.createCidrPeers(args),
        ...NativeNetworkPolicy.createServicePeers(args),
        ...NativeNetworkPolicy.createSelectorPeers(args),
      ],
      peer => JSON.stringify(peer),
    )

    return peers.length > 0 ? peers : undefined
  }

  private static createCidrPeers(
    args: NormalizedRuleArgs,
  ): types.input.networking.v1.NetworkPolicyPeer[] {
    return args.cidrs.map(cidr => ({ ipBlock: { cidr } }))
  }

  private static createServicePeers(
    args: NormalizedRuleArgs,
  ): types.input.networking.v1.NetworkPolicyPeer[] {
    return args.services.map(service => {
      const selector = mapServiceToLabelSelector(service)

      return {
        namespaceSelector: mapNamespaceNameToSelector(service.metadata.namespace),
        podSelector: selector,
      }
    })
  }

  private static createSelectorPeers(
    args: NormalizedRuleArgs,
  ): types.input.networking.v1.NetworkPolicyPeer[] {
    const selectorPeers = args.selectors.map(selector => ({
      podSelector: mapSelectorLikeToSelector(selector),
    }))

    const namespacePeers = args.namespaces.map(NativeNetworkPolicy.createNamespacePeer)

    if (namespacePeers.length === 0) {
      // if there are no namespaces, we can just return selector peers
      return selectorPeers
    }

    if (selectorPeers.length === 0) {
      // if there are no selectors, we can just return namespace peers
      return namespacePeers
    }

    // if there are both, we need to create a cartesian product
    return flat(
      selectorPeers.map(selectorPeer => {
        return namespacePeers.map(namespacePeer => merge(selectorPeer, namespacePeer))
      }),
    )
  }

  private static createNamespacePeer(
    this: void,
    namespace: NamespaceLike,
  ): types.input.networking.v1.NetworkPolicyPeer {
    const namespaceName = getNamespaceName(namespace)
    const namespaceSelector = mapNamespaceNameToSelector(namespaceName)

    return { namespaceSelector }
  }

  private static mapPorts(
    ports: NetworkPolicyPort[],
  ): types.input.networking.v1.NetworkPolicyPort[] {
    return ports.map(port => {
      if ("port" in port) {
        return {
          port: port.port,
          protocol: port.protocol ?? "TCP",
        }
      }

      return {
        port: port.range[0],
        endPort: port.range[1],
        protocol: port.protocol ?? "TCP",
      }
    })
  }
}
