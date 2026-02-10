import { l4EndpointToString } from "@highstate/common"
import { Chart, Namespace } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { charts } from "../shared"

const { args, inputs, outputs } = forUnit(k8s.apps.matrixStack)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const synapseHost = args.synapseHost ?? `synapse.${args.serverName}`
const elementWebHost = args.elementWebHost ?? `element.${args.serverName}`
const matrixAuthenticationServiceHost =
  args.matrixAuthenticationServiceHost ?? `mas.${args.serverName}`
const matrixRtcHost = args.matrixRtcHost ?? `mrtc.${args.serverName}`
const elementAdminHost = args.elementAdminHost ?? `admin.${args.serverName}`

const ingress = {
  ...(args.ingressClassName ? { className: args.ingressClassName } : {}),
  ...(args.ingressTlsSecret ? { tlsSecret: args.ingressTlsSecret } : {}),
  ...(args.ingressAnnotations && Object.keys(args.ingressAnnotations).length > 0
    ? { annotations: args.ingressAnnotations }
    : {}),
}

const chart = new Chart(args.appName, {
  namespace,

  chart: charts["matrix-stack"],
  serviceName: `${args.appName}-synapse`,

  values: {
    serverName: args.serverName,

    ...(Object.keys(ingress).length > 0 ? { ingress } : {}),

    synapse: {
      ingress: {
        host: synapseHost,
      },
    },
    elementWeb: {
      ingress: {
        host: elementWebHost,
      },
    },
    elementAdmin: {
      ingress: {
        host: elementAdminHost,
      },
    },
    matrixAuthenticationService: {
      ingress: {
        host: matrixAuthenticationServiceHost,
      },
    },
    matrixRTC: {
      ingress: {
        host: matrixRtcHost,
      },
    },
  },
})

const endpoints = await toPromise(chart.service.endpoints)

export default outputs({
  service: chart.service.entity,
  endpoints: chart.service.endpoints,

  $statusFields: {
    serverName: args.serverName,
    synapse: `https://${synapseHost}`,
    elementWeb: `https://${elementWebHost}`,
    elementAdmin: `https://${elementAdminHost}`,
    matrixAuthenticationService: `https://${matrixAuthenticationServiceHost}`,
    matrixRtc: `https://${matrixRtcHost}`,
    endpoints: endpoints.map(l4EndpointToString),
  },
})
