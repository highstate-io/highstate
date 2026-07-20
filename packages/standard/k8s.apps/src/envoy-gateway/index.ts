import { endpointToString } from "@highstate/common"
import { gateway as envoyGateway } from "@highstate/envoy-gateway-crds"
import { gateway } from "@highstate/gateway-api"
import {
  Chart,
  ClusterAccessScope,
  createServiceSpec,
  getProvider,
  Namespace,
} from "@highstate/k8s"
import { common, k8s } from "@highstate/library"
import { forUnit, makeEntityOutput, output, toPromise } from "@highstate/pulumi"
import { omit } from "remeda"
import { charts, processHelmResourcesPostRenderer } from "../shared"
import { createCertgenJob } from "./certgen"

const { stateId, args, inputs, outputs } = forUnit(k8s.apps.envoyGateway)

const clusterEndpoints = await toPromise(inputs.k8sCluster.endpoints)
const namespace = await Namespace.createOrGet(args.appName, { cluster: inputs.k8sCluster })
const certgenJob = await createCertgenJob({
  appName: args.appName,
  namespace,
  cluster: inputs.k8sCluster,
  scheduling: args.scheduling,
})

const chart = new Chart(
  args.appName,
  {
    namespace,
    args: {
      values: args.values,
      patches: args.patches,
    },

    chart: charts["envoy-gateway"],

    skipCrds: !args.installCrds,
    postRenderer: processHelmResourcesPostRenderer("remove-gateway-api-crds"),

    values: {
      deployment: {
        replicas: args.replicas,
        pod: args.scheduling,
      },

      certgen: {
        job: args.scheduling,
      },

      config: {
        envoyGateway: {
          gateway: {
            controllerName: args.controllerName,
          },
        },
      },
      ...(!args.installCrds && {
        crds: {
          gatewayAPI: {
            safeUpgradePolicy: {
              enabled: false,
            },
          },
        },
      }),
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
  },
  { dependsOn: certgenJob },
)

const envoyService = output({ cluster: inputs.k8sCluster, service: args.service }).apply(
  ({ cluster, service }) => {
    const serviceSpec = createServiceSpec({ ...service, external: args.external }, cluster)

    return output(serviceSpec).apply(serviceSpec => ({
      name: service.name,
      type: serviceSpec.type,
      annotations: service.metadata?.annotations,
      labels: service.metadata?.labels,
      patch: {
        type: "StrategicMerge",
        value: {
          spec: omit(serviceSpec, ["ports", "type"]),
        },
      },
    }))
  },
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
      provider: {
        type: "Kubernetes",
        kubernetes: {
          envoyDaemonSet: args.external ? {} : undefined,
          envoyService,
        },
      },
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
        resources: [
          "gateways",
          "httproutes",
          "referencegrants",
          "tcproutes",
          "tlsroutes",
          "udproutes",
        ],
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

  $terminals: chart.terminals,

  $statusFields: {
    endpoints: clusterEndpoints.map(endpointToString),
    gatewayClass: gatewayClass.metadata.name,
  },
})
