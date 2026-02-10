import { AccessPointRoute, l4EndpointToString } from "@highstate/common"
import { Chart, Namespace } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { charts } from "../shared"

const { args, inputs, outputs } = forUnit(k8s.apps.matrixStack)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const synapseHost = `synapse.${args.fqdn}`
const elementWebHost = `element.${args.fqdn}`
const matrixAuthenticationServiceHost = `mas.${args.fqdn}`
const matrixRtcHost = `mrtc.${args.fqdn}`
const elementAdminHost = `admin.${args.fqdn}`
const UNUSED_INGRESS_CLASS_NAME = "none"

const chart = new Chart(args.appName, {
  namespace,

  chart: charts["matrix-stack"],
  serviceName: `${args.appName}-synapse`,

  values: {
    serverName: args.fqdn,
    ingress: {
      className: UNUSED_INGRESS_CLASS_NAME,
    },

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
    wellKnownDelegation: {
      baseDomainRedirect: {
        enabled: false,
      },
    },
  },
})

const synapseService = chart.getServiceOutput(`${args.appName}-synapse`)
const elementWebService = chart.getServiceOutput(`${args.appName}-element-web`)
const elementAdminService = chart.getServiceOutput(`${args.appName}-element-admin`)
const matrixAuthenticationService = chart.getServiceOutput(
  `${args.appName}-matrix-authentication-service`,
)
const matrixRtcAuthorisationService = chart.getServiceOutput(
  `${args.appName}-matrix-rtc-authorisation-service`,
)
const matrixRtcSfuService = chart.getServiceOutput(`${args.appName}-matrix-rtc-sfu`)
const wellKnownService = chart.getServiceOutput(`${args.appName}-well-known`)

const commonRouteArgs = {
  accessPoint: inputs.accessPoint,
  type: "http" as const,
  tlsCertificateNativeData: namespace,
}

new AccessPointRoute(
  `${args.appName}-synapse`,
  {
    ...commonRouteArgs,
    fqdn: synapseHost,
    endpoints: synapseService.endpoints,
    gatewayNativeData: synapseService,
  },
  { dependsOn: chart.chart },
)
new AccessPointRoute(
  `${args.appName}-element-web`,
  {
    ...commonRouteArgs,
    fqdn: elementWebHost,
    endpoints: elementWebService.endpoints,
    gatewayNativeData: elementWebService,
  },
  { dependsOn: chart.chart },
)
new AccessPointRoute(
  `${args.appName}-element-admin`,
  {
    ...commonRouteArgs,
    fqdn: elementAdminHost,
    endpoints: elementAdminService.endpoints,
    gatewayNativeData: elementAdminService,
  },
  { dependsOn: chart.chart },
)
new AccessPointRoute(
  `${args.appName}-matrix-authentication-service`,
  {
    ...commonRouteArgs,
    fqdn: matrixAuthenticationServiceHost,
    endpoints: matrixAuthenticationService.endpoints,
    gatewayNativeData: matrixAuthenticationService,
  },
  { dependsOn: chart.chart },
)
new AccessPointRoute(
  `${args.appName}-matrix-rtc-sfu`,
  {
    ...commonRouteArgs,
    fqdn: matrixRtcHost,
    endpoints: matrixRtcSfuService.endpoints,
    gatewayNativeData: matrixRtcSfuService,
  },
  { dependsOn: chart.chart },
)
new AccessPointRoute(
  `${args.appName}-matrix-rtc-authorisation`,
  {
    ...commonRouteArgs,
    fqdn: matrixRtcHost,
    path: "/sfu/get",
    endpoints: matrixRtcAuthorisationService.endpoints,
    gatewayNativeData: matrixRtcAuthorisationService,
  },
  { dependsOn: chart.chart },
)
new AccessPointRoute(
  `${args.appName}-well-known`,
  {
    ...commonRouteArgs,
    fqdn: args.fqdn,
    path: "/.well-known/matrix",
    endpoints: wellKnownService.endpoints,
    gatewayNativeData: wellKnownService,
  },
  { dependsOn: chart.chart },
)

const endpoints = await toPromise(chart.service.endpoints)

export default outputs({
  service: chart.service.entity,
  endpoints: chart.service.endpoints,

  $statusFields: {
    serverName: args.fqdn,
    synapse: `https://${synapseHost}`,
    elementWeb: `https://${elementWebHost}`,
    elementAdmin: `https://${elementAdminHost}`,
    matrixAuthenticationService: `https://${matrixAuthenticationServiceHost}`,
    matrixRtc: `https://${matrixRtcHost}`,
    endpoints: endpoints.map(l4EndpointToString),
  },
})
