import { endpointToString } from "@highstate/common"
import { Chart, ClusterAccessScope, Namespace } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { charts } from "../shared"

const { name, args, inputs, outputs } = forUnit(k8s.apps.traefik)

const className = args.className ?? name
const clusterEndpoints = await toPromise(inputs.k8sCluster.endpoints)

const namespace = await Namespace.createOrGet(args.appName, { cluster: inputs.k8sCluster })

const chart = new Chart(args.appName, {
  namespace,

  chart: charts.traefik,
  serviceName: args.appName === "traefik" ? "traefik" : `${args.appName}-traefik`,

  skipCrds: true,

  values: {
    global: {
      // disable telemetry
      checkNewVersion: false,
      sendAnonymousUsage: false,
    },

    providers: {
      kubernetesCRD: {
        enabled: args.enableTraefikCrds,
      },

      kubernetesIngress: {
        enabled: args.enableIngressApi,
      },

      kubernetesGateway: {
        enabled: args.enableGatewayApi,
        experimentalChannel: true,
      },
    },

    deployment: {
      replicas: args.replicas,
    },

    gateway: {
      enabled: false,
    },

    ingressClass: {
      enabled: true,
      isDefaultClass: false,
      name: className,
    },

    gatewayClass: {
      name: className,
    },

    ports: {
      web: {
        redirections: {
          entryPoint: {
            to: "websecure",
            scheme: "https",
          },
        },
      },
    },
  },

  service: {
    external: args.external,
  },

  terminal: {
    shell: "sh",
  },

  networkPolicy: {
    ingressRule: {
      fromAll: true,
    },
    egressRule: {
      toAll: true,
    },
  },
})

// create a scope to manage cluster gateway resources
// this is not ideal in terms of permissions, but it is most restrictive way to grant generic access
const clusterScope = new ClusterAccessScope(name, {
  namespace,
  clusterWide: true,

  rules: [
    {
      apiGroups: ["gateway.networking.k8s.io"],
      resources: ["gateways", "httproutes"],
      verbs: ["*"],
    },
    {
      // to manage headless services and endpoints for non-kubernetes routes
      apiGroups: [""],
      resources: ["services", "endpoints"],
      verbs: ["*"],
    },
  ],
})

export default outputs({
  gateway: {
    implRef: {
      package: "@highstate/k8s",
      data: {
        cluster: clusterScope.cluster,
        namespace: namespace.entity,
        className,
        httpPort: 8080,
        httpsPort: 8443,
      },
    },
    endpoints: clusterEndpoints,
  },

  service: chart.service.entity,
  endpoints: chart.service.endpoints,

  $terminals: chart.terminals,

  $statusFields: {
    endpoints: clusterEndpoints.map(endpointToString),
  },
})
