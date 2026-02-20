import type { Secret } from "../secret"
import { type GatewayRouteSpec, gatewayRouteMediator, type TlsCertificate } from "@highstate/common"
import { k8s, type network } from "@highstate/library"
import { type ComponentResourceOptions, type Input, toPromise } from "@highstate/pulumi"
import { core } from "@pulumi/kubernetes"
import { Gateway, HttpRoute, TcpRoute, UdpRoute } from "../gateway"
import { Namespace } from "../namespace"
import { l4EndpointToServicePort, Service } from "../service"
import { getProvider, mapMetadata } from "../shared"
import { Certificate } from "../tls"

export const createGatewayRoute = gatewayRouteMediator.implement(
  k8s.gatewayDataSchema,
  async ({ name, spec, opts }, data) => {
    const namespace =
      spec.nativeData instanceof Service
        ? await toPromise(spec.nativeData.namespace)
        : Namespace.for(data.namespace, data.cluster)

    const certSecret = await getCertificateSecret(name, namespace, spec.tlsCertificate)

    const certificateRef = certSecret
      ? {
          kind: "Secret" as const,
          group: "" as const,
          name: certSecret.metadata.name,
        }
      : undefined

    if (spec.type === "http") {
      return await createHttpGatewayRoute({
        name,
        spec,
        opts,
        data,
        namespace,
        certificateRef,
      })
    }

    const protocol = spec.type === "tcp" ? "TCP" : "UDP"

    return await createL4GatewayRoute({
      name,
      spec,
      opts,
      data,
      namespace,
      protocol,
    })
  },
)

type HttpGatewayRouteSpec = Extract<GatewayRouteSpec, { type: "http" }>
type L4GatewayRouteSpec = Extract<GatewayRouteSpec, { type: "tcp" | "udp" }>

type CreateHttpGatewayRouteArgs = {
  name: string
  spec: HttpGatewayRouteSpec
  opts: ComponentResourceOptions | undefined
  data: k8s.GatewayData
  namespace: Namespace
  certificateRef:
    | {
        kind: "Secret"
        group: ""
        name: Input<string>
      }
    | undefined
}

async function createHttpGatewayRoute({
  name,
  spec,
  opts,
  data,
  namespace,
  certificateRef,
}: CreateHttpGatewayRouteArgs) {
  const backendService =
    spec.nativeData instanceof Service
      ? spec.nativeData
      : (await createServiceFromEndpoints(name, namespace, spec.endpoints, data.cluster, opts))
          .service

  const listeners = [
    {
      name: "https",
      port: data.httpsPort,
      protocol: "HTTPS",
      hostname: spec.fqdn,
      tls: {
        mode: "Terminate",
        certificateRefs: certificateRef ? [certificateRef] : undefined,
      },
    },
  ]

  const gateway = await Gateway.createOnce(
    {
      name: data.className,
      namespace,
      gatewayClassName: data.className,
      listeners,
    },
    opts,
  )

  const httpRoute = new HttpRoute(
    name,
    {
      gateway,
      rule: {
        backend: {
          service: backendService,
          port: spec.targetPort,
        },
      },
    },
    opts,
  )

  return {
    resource: httpRoute,
    endpoints: await toPromise(gateway.endpoints),
  }
}

type CreateL4GatewayRouteArgs = {
  name: string
  spec: L4GatewayRouteSpec
  opts: ComponentResourceOptions | undefined
  data: k8s.GatewayData
  namespace: Namespace
  protocol: "TCP" | "UDP"
}

async function createL4GatewayRoute({
  name,
  spec,
  opts,
  data,
  namespace,
  protocol,
}: CreateL4GatewayRouteArgs) {
  const serviceData =
    spec.nativeData instanceof Service
      ? {
          service: spec.nativeData,
          ports: await getServicePorts(spec.nativeData),
        }
      : await createServiceFromEndpoints(name, namespace, spec.endpoints, data.cluster, opts)

  const serviceName = await toPromise(serviceData.service.metadata.name)

  const backendPort = await selectBackendPort({
    ports: serviceData.ports,
    protocol,
    targetPort: spec.targetPort,
    serviceName,
    routeName: name,
  })

  const listenerPort = await resolveListenerPort({
    requestedPort: spec.port,
    backendPort,
    protocol,
    routeName: name,
  })

  const listenerName = `${protocol.toLowerCase()}-${listenerPort}`

  const gateway = await Gateway.createOnce(
    {
      name: data.className,
      namespace,
      gatewayClassName: data.className,
      listeners: [
        {
          name: listenerName,
          port: listenerPort,
          protocol,
        },
      ],
    },
    opts,
  )

  const backendRef = serviceData.service.metadata.apply(metadata => {
    if (!metadata?.name) {
      throw new Error(
        `Service "${serviceName}" referenced by gateway route "${name}" does not have a name.`,
      )
    }

    return {
      name: metadata.name,
      namespace: metadata.namespace,
      port: backendPort.port,
    }
  })

  const routeOpts = { ...opts, parent: gateway }

  const route =
    protocol === "TCP"
      ? new TcpRoute(
          name,
          {
            gateway,
            listenerName,
            backend: backendRef,
          },
          routeOpts,
        )
      : new UdpRoute(
          name,
          {
            gateway,
            listenerName,
            backend: backendRef,
          },
          routeOpts,
        )

  return {
    resource: route,
    endpoints: await toPromise(gateway.endpoints),
  }
}

async function getCertificateSecret(
  _name: string,
  namespace: Namespace,
  tlsCertificate: Input<TlsCertificate | undefined> | undefined,
): Promise<Secret | undefined> {
  const resolvedCertificate = await toPromise(tlsCertificate)
  if (!resolvedCertificate) {
    return undefined
  }

  const resource = await toPromise(resolvedCertificate.resource)

  if (resource instanceof Certificate) {
    const certNamespace = await toPromise(resource.namespace.metadata.name)
    const certClusterId = await toPromise(resource.namespace.cluster.id)

    const targetNamespace = await toPromise(namespace.metadata.name)
    const targetClusterId = await toPromise(namespace.cluster.id)

    if (certNamespace === targetNamespace && certClusterId === targetClusterId) {
      return await toPromise(resource.secret)
    }
  }

  throw new Error(
    "Not implemented: copying certificate secret across namespaces/clusters/different systems",
  )
}

type ServicePortInfo = {
  name: string | undefined
  port: number
  protocol: "TCP" | "UDP"
  targetPort?: number | string
}

async function createServiceFromEndpoints(
  name: string,
  namespace: Namespace,
  endpointsInput: Input<network.L4Endpoint[]>,
  cluster: k8s.Cluster,
  opts: ComponentResourceOptions | undefined,
): Promise<{ service: Service; ports: ServicePortInfo[] }> {
  const endpoints = await toPromise(endpointsInput)

  if (!endpoints.length) {
    throw new Error(`Gateway route "${name}" has no endpoints to expose.`)
  }

  const hostnameEndpoints = endpoints.filter(endpoint => endpoint.type === "hostname")
  const ipEndpoints = endpoints.filter(endpoint => endpoint.type !== "hostname")

  if (hostnameEndpoints.length > 0) {
    const hostnamePortInfos: ServicePortInfo[] = []
    for (const endpoint of hostnameEndpoints) {
      hostnamePortInfos.push(toServicePortInfoFromEndpoint(endpoint))
    }

    const service = Service.create(`hs-backend-${name}`, {
      namespace,
      type: "ExternalName",
      externalName: hostnameEndpoints[0].hostname,
      ports: hostnameEndpoints.map(l4EndpointToServicePort),
    })

    return {
      service,
      ports: hostnamePortInfos,
    }
  }

  if (ipEndpoints.length === 0) {
    throw new Error(`Gateway route "${name}" requires at least one IP endpoint.`)
  }

  const ipPortInfos: ServicePortInfo[] = []
  for (const endpoint of ipEndpoints) {
    ipPortInfos.push(toServicePortInfoFromEndpoint(endpoint))
  }

  const service = Service.create(`hs-backend-${name}`, {
    namespace,
    type: "ClusterIP",
    ports: ipEndpoints.map(l4EndpointToServicePort),
  })

  const endpointsName = `hs-backend-${name}`

  new core.v1.Endpoints(
    endpointsName,
    {
      metadata: mapMetadata({ namespace }, endpointsName),
      subsets: ipEndpoints.map(endpoint => ({
        addresses: [{ ip: endpoint.address.value }],
        ports: [l4EndpointToServicePort(endpoint)],
      })),
    },
    { ...opts, provider: getProvider(cluster), parent: service },
  )

  return {
    service,
    ports: ipPortInfos,
  }
}

async function getServicePorts(service: Service): Promise<ServicePortInfo[]> {
  const spec = await toPromise(service.spec)
  const ports = spec.ports ?? []

  const result: ServicePortInfo[] = []

  for (const port of ports) {
    const value = port.port
    const protocol = (port.protocol ?? "TCP").toUpperCase()

    if (value === undefined || (protocol !== "TCP" && protocol !== "UDP")) {
      continue
    }

    result.push({
      name: port.name ?? undefined,
      port: value,
      protocol: protocol as "TCP" | "UDP",
      targetPort: port.targetPort as number | string | undefined,
    })
  }

  return result
}

function toServicePortInfoFromEndpoint(endpoint: network.L4Endpoint): ServicePortInfo {
  return {
    name: undefined,
    port: endpoint.port,
    protocol: endpoint.protocol.toUpperCase() as "TCP" | "UDP",
    targetPort: endpoint.port,
  }
}

async function selectBackendPort({
  ports,
  protocol,
  targetPort,
  serviceName,
  routeName,
}: {
  ports: ServicePortInfo[]
  protocol: "TCP" | "UDP"
  targetPort: Input<string | number | undefined> | undefined
  serviceName: string
  routeName: string
}): Promise<ServicePortInfo> {
  const candidates = ports.filter(port => port.protocol === protocol)

  if (candidates.length === 0) {
    throw new Error(
      `Service "${serviceName}" does not expose any ${protocol} ports required by gateway route "${routeName}".`,
    )
  }

  if (!targetPort) {
    return candidates[0]
  }

  const resolvedTarget = await toPromise(targetPort)

  if (resolvedTarget === undefined || resolvedTarget === null) {
    return candidates[0]
  }

  if (typeof resolvedTarget === "number") {
    const match = candidates.find(candidate => {
      if (candidate.port === resolvedTarget) {
        return true
      }

      if (typeof candidate.targetPort === "number") {
        return candidate.targetPort === resolvedTarget
      }

      return false
    })

    if (match) {
      return match
    }

    throw new Error(
      `Gateway route "${routeName}" requested target port ${resolvedTarget}, but service "${serviceName}" does not expose it for ${protocol} backends.`,
    )
  }

  const targetString = String(resolvedTarget)

  const match = candidates.find(candidate => {
    if (candidate.name === targetString) {
      return true
    }

    if (typeof candidate.targetPort === "string") {
      return candidate.targetPort === targetString
    }

    return false
  })

  if (match) {
    return match
  }

  throw new Error(
    `Gateway route "${routeName}" requested target port "${targetString}", but service "${serviceName}" does not expose it for ${protocol} backends.`,
  )
}

async function resolveListenerPort({
  requestedPort,
  backendPort,
  protocol,
  routeName,
}: {
  requestedPort: Input<number | undefined> | undefined
  backendPort: ServicePortInfo
  protocol: "TCP" | "UDP"
  routeName: string
}): Promise<number> {
  if (!requestedPort) {
    return backendPort.port
  }

  const resolved = await toPromise(requestedPort)

  if (resolved === undefined || resolved === null) {
    return backendPort.port
  }

  if (!Number.isInteger(resolved)) {
    throw new Error(
      `Gateway route "${routeName}" must use integer listener ports for ${protocol.toLowerCase()} traffic.`,
    )
  }

  const port = Number(resolved)

  if (port < 1 || port > 65535) {
    throw new Error(
      `Gateway route "${routeName}" specified listener port ${port}, which is outside the valid range 1-65535.`,
    )
  }

  return port
}
