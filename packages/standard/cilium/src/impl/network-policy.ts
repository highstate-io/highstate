import type { types as k8sTypes } from "@pulumi/kubernetes"
import { cilium, type types } from "@highstate/cilium-crds"
import { check } from "@highstate/contract"
import {
  getNamespaceName,
  mapMetadata,
  mapSelectorLikeToSelector,
  mapServiceToLabelSelector,
  type NetworkPolicyPort,
  type NormalizedNetworkPolicyArgs,
  type NormalizedRuleArgs,
  networkPolicyMediator,
} from "@highstate/k8s"
import { implementationReferenceSchema, k8s } from "@highstate/library"
import { ComponentResource, output, type ResourceOptions } from "@highstate/pulumi"
import { map, mapKeys, pipe, uniqueBy } from "remeda"

type Rule = types.input.cilium.v2.CiliumNetworkPolicySpecIngress &
  types.input.cilium.v2.CiliumNetworkPolicySpecEgress

class CiliumNetworkPolicy extends ComponentResource {
  /**
   * The underlying Cilium network policy resource.
   */
  public readonly networkPolicy: cilium.v2.CiliumNetworkPolicy

  constructor(name: string, args: NormalizedNetworkPolicyArgs, opts?: ResourceOptions) {
    super("highstate:cilium:NetworkPolicy", name, args, opts)

    this.networkPolicy = new cilium.v2.CiliumNetworkPolicy(
      name,
      {
        metadata: mapMetadata(args, name),
        spec: {
          description: args.description,
          endpointSelector: args.podSelector,
          ingress: CiliumNetworkPolicy.createIngressRules(args),
          egress: CiliumNetworkPolicy.createEgressRules(args),
        },
      },
      { ...opts, parent: this },
    )
  }

  private static createIngressRules(args: NormalizedNetworkPolicyArgs): Rule[] {
    if (args.isolateIngress) {
      return [{}]
    }

    return uniqueBy(
      args.ingressRules.flatMap(rule =>
        CiliumNetworkPolicy.createRules("from", rule, args.cluster),
      ),
      rule => JSON.stringify(rule),
    )
  }

  private static createEgressRules(args: NormalizedNetworkPolicyArgs): Rule[] {
    if (args.isolateEgress) {
      return [{}]
    }

    const extraRules: Rule[] = []

    if (args.allowKubeApiServer) {
      extraRules.push({ toEntities: ["kube-apiserver"] })
    }

    return uniqueBy(
      args.egressRules
        .flatMap(rule => CiliumNetworkPolicy.createRules("to", rule, args.cluster))
        .concat(extraRules),
      rule => JSON.stringify(rule),
    )
  }

  private static createRules(
    prefix: "from" | "to",
    rule: NormalizedRuleArgs,
    cluster: k8s.Cluster,
  ): Rule[] {
    const port = CiliumNetworkPolicy.mapPorts(rule.ports)
    const ports = port ? [port] : undefined

    return [
      ...CiliumNetworkPolicy.createAllRules(prefix, rule, ports),
      ...CiliumNetworkPolicy.createCidrRules(prefix, rule, ports),
      ...CiliumNetworkPolicy.createServiceRules(prefix, rule, ports),
      ...CiliumNetworkPolicy.createSelectorRules(prefix, rule, ports),
      ...(prefix === "to" ? CiliumNetworkPolicy.createFqdnRules(rule, ports, cluster) : []),
    ]
  }

  private static createAllRules(
    prefix: "from" | "to",
    rule: NormalizedRuleArgs,
    ports: types.input.cilium.v2.CiliumNetworkPolicySpecEgressToPorts[] | undefined,
  ): Rule[] {
    if (!rule.all) {
      return []
    }

    return [
      {
        [`${prefix}Entities`]: ["all"],
        toPorts: ports,
      },
    ]
  }

  private static createCidrRules(
    prefix: "from" | "to",
    rule: NormalizedRuleArgs,
    ports: types.input.cilium.v2.CiliumNetworkPolicySpecEgressToPorts[] | undefined,
  ): Rule[] {
    if (rule.cidrs.length === 0) {
      return []
    }

    return [
      {
        [`${prefix}CIDR`]: rule.cidrs,
        toPorts: ports,
      },
    ]
  }

  private static createFqdnRules(
    rule: NormalizedRuleArgs,
    ports: types.input.cilium.v2.CiliumNetworkPolicySpecEgressToPorts[] | undefined,
    cluster: k8s.Cluster,
  ): types.input.cilium.v2.CiliumNetworkPolicySpecEgress[] {
    if (rule.fqdns.length === 0) {
      return []
    }

    const fqdnRules = rule.fqdns.map(fqdn => {
      return fqdn.includes("*") ? { matchPattern: fqdn } : { matchName: fqdn }
    })

    return [
      {
        toFQDNs: fqdnRules,
        toPorts: ports,
      },
      {
        toEndpoints: [
          {
            matchLabels: {
              "k8s:io.kubernetes.pod.namespace": "kube-system",
              "k8s:k8s-app": "kube-dns",
            },
          },
        ],
        toPorts: [
          {
            ports: [{ port: "53", protocol: "UDP" }],
            rules: {
              dns:
                check(k8s.ciliumClusterMetadata, cluster.metadata) &&
                cluster.metadata.cilium.allowForbiddenFqdnResolution
                  ? [{ matchPattern: "*" }]
                  : fqdnRules,
            },
          },
        ],
      },
    ]
  }

  private static createServiceRules(
    prefix: "from" | "to",
    rule: NormalizedRuleArgs,
    ports: types.input.cilium.v2.CiliumNetworkPolicySpecEgressToPorts[] | undefined,
  ): Rule[] {
    if (rule.services.length === 0) {
      return []
    }

    const selectors = rule.services.map(service => {
      const selector = mapServiceToLabelSelector(service)

      return output(selector).apply(selector => ({
        matchLabels: {
          ...mapKeys(selector.matchLabels ?? {}, key => `k8s:${key}`),
          "k8s:io.kubernetes.pod.namespace": service.metadata.namespace,
        },
      }))
    })

    return [
      {
        [`${prefix}Endpoints`]: selectors,
        toPorts: ports,
      },
    ]
  }

  private static createNamespaceExpressions(
    rule: NormalizedRuleArgs,
  ): k8sTypes.input.meta.v1.LabelSelectorRequirement[] {
    if (rule.namespaces.length === 0) {
      return []
    }

    return pipe(rule.namespaces, map(getNamespaceName), names => [
      {
        key: "k8s:io.kubernetes.pod.namespace",
        operator: "In",
        values: names,
      },
    ])
  }

  private static createSelectorRules(
    prefix: "from" | "to",
    rule: NormalizedRuleArgs,
    ports: types.input.cilium.v2.CiliumNetworkPolicySpecEgressToPorts[] | undefined,
  ): types.input.cilium.v2.CiliumNetworkPolicySpecIngress[] {
    const namespaceExpressions = CiliumNetworkPolicy.createNamespaceExpressions(rule)

    if (rule.selectors.length === 0) {
      if (namespaceExpressions.length === 0) {
        // if no selectors and no namespaces are provided, we do not match
        return []
      }

      // if no selectors are provided, we only match on namespaces
      return [
        {
          [`${prefix}Endpoints`]: [{ matchExpressions: namespaceExpressions }],
          toPorts: ports,
        },
      ]
    }

    // otherwise, we match on selectors and namespaces
    const selectors = rule.selectors.map(selector => {
      const rawSelector = mapSelectorLikeToSelector(selector)

      return output(rawSelector).apply(rawSelector => {
        const expressions = map(rawSelector.matchExpressions ?? [], expression => ({
          key: `k8s:${expression.key}`,
          operator: expression.operator,
          values: expression.values,
        }))

        return {
          matchLabels: mapKeys(rawSelector.matchLabels ?? {}, key => `k8s:${key}`),
          matchExpressions: [...expressions, ...namespaceExpressions],
        }
      })
    })

    return [
      {
        [`${prefix}Endpoints`]: uniqueBy(selectors, rule => JSON.stringify(rule)),
        toPorts: ports,
      },
    ]
  }

  private static mapPorts(
    ports: NetworkPolicyPort[],
  ): types.input.cilium.v2.CiliumNetworkPolicySpecEgressToPorts | undefined {
    if (ports.length === 0) {
      return
    }

    return {
      ports: ports.map(port => {
        if ("port" in port) {
          return {
            port: port.port.toString(),
            protocol: port.protocol ?? "TCP",
          }
        }

        return {
          port: port.range[0].toString(),
          endPort: port.range[1],
          protocol: port.protocol ?? "TCP",
        }
      }),
    }
  }
}

export const createNetworkPolicy = networkPolicyMediator.implement(
  implementationReferenceSchema,
  ({ name, args }) => {
    return new CiliumNetworkPolicy(name, args)
  },
)
