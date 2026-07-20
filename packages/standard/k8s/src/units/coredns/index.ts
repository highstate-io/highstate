import { l3EndpointToString } from "@highstate/common"
import { text } from "@highstate/contract"
import { k8s } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { ConfigMap } from "../../config-map"
import { Namespace } from "../../namespace"
import { requireBestEndpoint } from "../../network"
import { ClusterAccessScope } from "../../rbac"
import { Workload } from "../../workload"

const { args, inputs, outputs } = forUnit(k8s.coreDns)
const cluster = await toPromise(inputs.k8sCluster)
const apiEndpoint = args.useExternalKubeApi ? requireBestEndpoint(cluster.apiEndpoints) : undefined

const namespace = Namespace.get("kube-system", {
  name: "kube-system",
  cluster,
})

const config = ConfigMap.create("coredns", {
  name: "coredns",
  namespace,
  data: {
    Corefile: text`
      .:53 {
          errors
          health
          ready
          kubernetes ${args.clusterDomain} in-addr.arpa ip6.arpa {
            pods insecure
            fallthrough in-addr.arpa ip6.arpa
            ttl 30
          }
          prometheus :9153
          cache 30
          loop
          reload
          loadbalance
          forward . /etc/resolv.conf
      }
    `,
  },
})

const access = new ClusterAccessScope("coredns", {
  namespace,
  clusterWide: true,
  allowOriginNamespace: false,
  rules: [
    {
      apiGroups: [""],
      resources: ["endpoints", "services", "pods", "namespaces"],
      verbs: ["list", "watch"],
    },
    {
      apiGroups: ["discovery.k8s.io"],
      resources: ["endpointslices"],
      verbs: ["list", "watch"],
    },
  ],
})

const podSpec = {
  serviceAccountName: access.serviceAccountName,
  dnsPolicy: "Default",
  automountServiceAccountToken: true,
  priorityClassName: "system-cluster-critical",
  nodeSelector: args.scheduling.nodeSelector ?? {
    "kubernetes.io/os": "linux",
  },
  affinity: args.scheduling.affinity,
  tolerations: args.scheduling.tolerations ?? [
    {
      key: "CriticalAddonsOnly",
      operator: "Exists" as const,
    },
    {
      key: "node-role.kubernetes.io/control-plane",
      operator: "Exists" as const,
      effect: "NoSchedule" as const,
    },
    ...(args.mode === "node" ? [{ operator: "Exists" as const }] : []),
  ],
  topologySpreadConstraints:
    args.mode === "cluster"
      ? [
          {
            maxSkew: 1,
            topologyKey: "kubernetes.io/hostname",
            whenUnsatisfiable: "DoNotSchedule",
            labelSelector: {
              matchLabels: {
                "app.kubernetes.io/name": "coredns",
              },
            },
          },
          {
            maxSkew: 1,
            topologyKey: "topology.kubernetes.io/zone",
            whenUnsatisfiable: "ScheduleAnyway",
            labelSelector: {
              matchLabels: {
                "app.kubernetes.io/name": "coredns",
              },
            },
          },
        ]
      : [],
}

Workload.createOrPatchGeneric("coredns", {
  namespace,
  defaultType: args.mode === "node" ? "DaemonSet" : "Deployment",
  existing: undefined,
  service: {
    name: "kube-dns",
    clusterIP: args.clusterIP,
    internalTrafficPolicy: args.mode === "node" ? "Local" : undefined,
    ports: [
      {
        name: "dns",
        port: 53,
        targetPort: 53,
        protocol: "UDP",
      },
      {
        name: "dns-tcp",
        port: 53,
        targetPort: 53,
        protocol: "TCP",
      },
      {
        name: "metrics",
        port: 9153,
        targetPort: 9153,
        protocol: "TCP",
      },
    ],
    metadata: {
      labels: {
        "kubernetes.io/cluster-service": "true",
        "kubernetes.io/name": "CoreDNS",
      },
      annotations: {
        "prometheus.io/port": "9153",
        "prometheus.io/scrape": "true",
      },
    },
  },
  container: {
    name: "coredns",
    image: "rancher/mirrored-coredns-coredns:1.14.6",
    imagePullPolicy: "IfNotPresent",
    args: ["-conf", "/etc/coredns/Corefile"],
    environment: apiEndpoint
      ? {
          KUBERNETES_SERVICE_HOST: l3EndpointToString(apiEndpoint),
          KUBERNETES_SERVICE_PORT: apiEndpoint.port.toString(),
        }
      : undefined,
    resources: {
      limits: {
        memory: "170Mi",
      },
      requests: {
        cpu: "100m",
        memory: "70Mi",
      },
    },
    ports: [
      {
        name: "dns",
        containerPort: 53,
        protocol: "UDP",
      },
      {
        name: "dns-tcp",
        containerPort: 53,
        protocol: "TCP",
      },
      {
        name: "metrics",
        containerPort: 9153,
        protocol: "TCP",
      },
    ],
    securityContext: {
      allowPrivilegeEscalation: false,
      capabilities: {
        add: ["NET_BIND_SERVICE"],
        drop: ["all"],
      },
      readOnlyRootFilesystem: true,
    },
    livenessProbe: {
      httpGet: {
        path: "/health",
        port: 8080,
        scheme: "HTTP",
      },
      initialDelaySeconds: 60,
      periodSeconds: 10,
      timeoutSeconds: 1,
      successThreshold: 1,
      failureThreshold: 3,
    },
    readinessProbe: {
      httpGet: {
        path: "/ready",
        port: 8181,
        scheme: "HTTP",
      },
      initialDelaySeconds: 0,
      periodSeconds: 2,
      timeoutSeconds: 1,
      successThreshold: 1,
      failureThreshold: 3,
    },
    volumeMount: {
      name: "config-volume",
      mountPath: "/etc/coredns",
      readOnly: true,
      volume: config,
    },
  },
  deployment: {
    revisionHistoryLimit: 0,
  },
  replicas: 2,
  strategy: {
    type: "RollingUpdate",
    rollingUpdate: {
      maxUnavailable: 1,
    },
  },
  template: {
    spec: podSpec,
  },
  metadata: {
    labels: {
      "k8s-app": "kube-dns",
      "kubernetes.io/name": "CoreDNS",
    },
  },
})

export default outputs({
  k8sCluster: inputs.k8sCluster,
})
