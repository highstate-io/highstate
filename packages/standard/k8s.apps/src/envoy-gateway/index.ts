import { endpointToString } from "@highstate/common"
import { gateway as envoyGateway } from "@highstate/envoy-gateway-crds"
import { gateway } from "@highstate/gateway-api"
import { Chart, ClusterAccessScope, getProvider, Namespace } from "@highstate/k8s"
import { common, k8s } from "@highstate/library"
import { forUnit, makeEntityOutput, toPromise } from "@highstate/pulumi"
import { deepmerge } from "deepmerge-ts"
import { charts, processHelmResourcesPostRenderer } from "../shared"
import { createCertgenJob } from "./certgen"

const { stateId, args, inputs, outputs } = forUnit(k8s.apps.envoyGateway)

const clusterEndpoints = await toPromise(inputs.k8sCluster.endpoints)
const namespace = await Namespace.createOrGet(args.appName, { cluster: inputs.k8sCluster })
const certgenJob = await createCertgenJob({
  appName: args.appName,
  namespace,
  cluster: inputs.k8sCluster,
  nodeSelector: args.nodeSelector,
})

const chart = new Chart(
  args.appName,
  {
    namespace,

    chart: charts["envoy-gateway"],
    serviceName: "envoy-gateway",

    skipCrds: !args.installCrds,
    postRenderer: processHelmResourcesPostRenderer("remove-gateway-api-crds"),

    values: deepmerge(
      {
        deployment: {
          replicas: args.replicas,
          pod: {
            nodeSelector: args.nodeSelector,
          },
        },

        certgen: {
          job: {
            nodeSelector: args.nodeSelector,
          },
        },

        config: {
          envoyGateway: {
            gateway: {
              controllerName: args.controllerName,
            },
          },
        },
      },
      args.installCrds
        ? {}
        : {
            crds: {
              gatewayAPI: {
                safeUpgradePolicy: {
                  enabled: false,
                },
              },
            },
          },
      args.values,
    ),

    service: deepmerge(args.service, {
      external: args.external,
    }),

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
  },
  { dependsOn: certgenJob },
)

const envoyProxy = new envoyGateway.v1alpha1.EnvoyProxy(
  args.appName,
  {
    metadata: {
      name: "default",
      namespace: namespace.metadata.name,
    },
    spec: {
      mergeGateways: true,
    },
  },
  {
    dependsOn: chart.chart,
    provider: getProvider(inputs.k8sCluster),
  },
)

const gatewayClass = new gateway.v1.GatewayClass(
  args.className,
  {
    metadata: {
      name: args.className,
    },
    spec: {
      controllerName: args.controllerName,
      parametersRef: {
        group: "gateway.envoyproxy.io",
        kind: "EnvoyProxy",
        name: envoyProxy.metadata.name,
        namespace: namespace.metadata.name,
      },
    },
  },
  {
    dependsOn: envoyProxy,
    provider: getProvider(inputs.k8sCluster),
  },
)

const clusterScope = new ClusterAccessScope(
  args.appName,
  {
    namespace,
    clusterWide: true,

    rules: [
      {
        apiGroups: ["gateway.networking.k8s.io"],
        resources: ["gateways", "httproutes", "tcproutes", "udproutes"],
        verbs: ["*"],
      },
      {
        apiGroups: ["gateway.envoyproxy.io"],
        resources: ["clienttrafficpolicies"],
        verbs: ["*"],
      },
      {
        apiGroups: [""],
        resources: ["services", "endpoints", "secrets"],
        verbs: ["*"],
      },
    ],
  },
  { dependsOn: gatewayClass },
)

export default outputs({
  gateway: makeEntityOutput({
    entity: common.gatewayEntity,
    identity: stateId,
    meta: {
      title: args.className,
    },
    value: {
      implRef: {
        package: "@highstate/k8s",
        data: {
          cluster: clusterScope.cluster,
          namespace: namespace.entity,
          className: args.className,
          httpPort: 80,
          httpsPort: 443,
          controllerImplRef: {
            package: "@highstate/envoy",
            data: {},
          },
        },
      },
      endpoints: clusterEndpoints,
    },
  }),

  service: chart.service.entity,
  endpoints: chart.service.endpoints,

  $terminals: chart.terminals,

  $statusFields: {
    endpoints: clusterEndpoints.map(endpointToString),
    gatewayClass: gatewayClass.metadata.name,
  },
})
