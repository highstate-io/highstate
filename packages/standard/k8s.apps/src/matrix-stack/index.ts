import { chmod } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { AccessPointRoute, l4EndpointToString } from "@highstate/common"
import { getProviderAsync, Namespace, resolveHelmChart, Service } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { helm } from "@pulumi/kubernetes"
import { charts } from "../shared"

const { args, inputs, outputs } = forUnit(k8s.apps.matrixStack)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const synapseHost = `matrix.${args.fqdn}`
const elementWebHost = `chat.${args.fqdn}`
const matrixAuthenticationServiceHost = `account.${args.fqdn}`
const matrixRtcHost = `mrtc.${args.fqdn}`
const elementAdminHost = `admin.${args.fqdn}`
const HELM_INGRESS_DISABLED_VALUE = "none"
const postrenderScript = fileURLToPath(new URL("./postrender.js", import.meta.url))

try {
  await chmod(postrenderScript, 0o755)
} catch (error) {
  throw new Error(`Failed to mark Helm postrender script as executable`, { cause: error })
}

const provider = await getProviderAsync(inputs.k8sCluster)
const chartPath = await resolveHelmChart(charts["matrix-stack"])

const release = new helm.v3.Release(
  args.appName,
  {
    chart: chartPath,
    namespace: namespace.metadata.name,

    values: {
      serverName: args.fqdn,
      ingress: {
        className: HELM_INGRESS_DISABLED_VALUE,
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

    postrender: postrenderScript,
  },
  { provider, dependsOn: namespace },
)

const serviceOptions = { dependsOn: release }
const synapseService = Service.get(
  `${args.appName}-synapse`,
  { namespace, name: `${args.appName}-synapse` },
  serviceOptions,
)
const elementWebService = Service.get(
  `${args.appName}-element-web`,
  { namespace, name: `${args.appName}-element-web` },
  serviceOptions,
)
const elementAdminService = Service.get(
  `${args.appName}-element-admin`,
  { namespace, name: `${args.appName}-element-admin` },
  serviceOptions,
)
const matrixAuthenticationService = Service.get(
  `${args.appName}-matrix-authentication-service`,
  { namespace, name: `${args.appName}-matrix-authentication-service` },
  serviceOptions,
)
const matrixRtcAuthorisationService = Service.get(
  `${args.appName}-matrix-rtc-authorisation-service`,
  { namespace, name: `${args.appName}-matrix-rtc-authorisation-service` },
  serviceOptions,
)
const matrixRtcSfuService = Service.get(
  `${args.appName}-matrix-rtc-sfu`,
  { namespace, name: `${args.appName}-matrix-rtc-sfu` },
  serviceOptions,
)
const wellKnownService = Service.get(
  `${args.appName}-well-known`,
  { namespace, name: `${args.appName}-well-known` },
  serviceOptions,
)

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
  { dependsOn: release },
)
new AccessPointRoute(
  `${args.appName}-element-web`,
  {
    ...commonRouteArgs,
    fqdn: elementWebHost,
    endpoints: elementWebService.endpoints,
    gatewayNativeData: elementWebService,
  },
  { dependsOn: release },
)
new AccessPointRoute(
  `${args.appName}-element-admin`,
  {
    ...commonRouteArgs,
    fqdn: elementAdminHost,
    endpoints: elementAdminService.endpoints,
    gatewayNativeData: elementAdminService,
  },
  { dependsOn: release },
)
new AccessPointRoute(
  `${args.appName}-matrix-authentication-service`,
  {
    ...commonRouteArgs,
    fqdn: matrixAuthenticationServiceHost,
    endpoints: matrixAuthenticationService.endpoints,
    gatewayNativeData: matrixAuthenticationService,
  },
  { dependsOn: release },
)
new AccessPointRoute(
  `${args.appName}-matrix-rtc-sfu`,
  {
    ...commonRouteArgs,
    fqdn: matrixRtcHost,
    endpoints: matrixRtcSfuService.endpoints,
    gatewayNativeData: matrixRtcSfuService,
  },
  { dependsOn: release },
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
  { dependsOn: release },
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
  { dependsOn: release },
)

const endpoints = await toPromise(synapseService.endpoints)

export default outputs({
  service: synapseService.entity,
  endpoints: synapseService.endpoints,

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
