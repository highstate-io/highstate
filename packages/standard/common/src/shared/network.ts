import { network, type ArrayPatchMode, type Labels, type LabelValue } from "@highstate/library"
import { type Input, toPromise } from "@highstate/pulumi"
import { map, pipe, uniqueBy } from "remeda"
import { filterByLabels } from "./utils"

/**
 * The input L3, L4, or L7 endpoint for some service.
 *
 * Can be provided as a string or an object.
 */
export type InputEndpoint = network.L3Endpoint | string

/**
 * The input L4 or L7 endpoint for some service.
 *
 * Can be provided as a string or an object.
 */
export type InputL4Endpoint = network.L4Endpoint | string

/**
 * The input L7 endpoint for some service.
 *
 * Can be provided as a string or an object.
 */
export type InputL7Endpoint = network.L7Endpoint | string

/**
 * Stringifies a L3 endpoint object into a string.
 *
 * The result format is simply the address or hostname.
 * The format does not depend on runtime level and will produce the same output for L3, L4, and L7 endpoints.
 *
 * @param l3Endpoint The L3 endpoint object to stringify.
 * @returns The string representation of the L3 endpoint.
 */
export function l3EndpointToString(l3Endpoint: network.L3Endpoint): string {
  switch (l3Endpoint.type) {
    case "ipv4":
      return l3Endpoint.address
    case "ipv6":
      return l3Endpoint.address
    case "hostname":
      return l3Endpoint.hostname
  }
}

/**
 * Stringifies a L4 endpoint object into a string.
 *
 * The result format is:
 * - `[endpoint]:port` for IPv6;
 * - `endpoint:port` for IPv4 and hostname.
 *
 * The format does not depend on runtime level and will produce the same output for L4 and L7 endpoints.
 *
 * @param l4Endpoint The L4 endpoint object to stringify.
 * @returns The string representation of the L4 endpoint.
 */
export function l4EndpointToString(l4Endpoint: network.L4Endpoint): string {
  if (l4Endpoint.type === "ipv6") {
    return `[${l4Endpoint.address}]:${l4Endpoint.port}`
  }

  return `${l3EndpointToString(l4Endpoint)}:${l4Endpoint.port}`
}

/**
 * Stringifies a L4 endpoint object into a string with protocol.
 *
 * The result format is:
 * - `protocol://[endpoint]:port` for IPv6;
 * - `protocol://endpoint:port` for IPv4 and hostname.
 *
 * The format does not depend on runtime level and will produce the same output for L4 and L7 endpoints.
 *
 * @param l4Endpoint The L4 endpoint object to stringify.
 * @returns The string representation of the L4 endpoint with protocol.
 */
export function l4EndpointToFullString(l4Endpoint: network.L4Endpoint): string {
  const protocol = `${l4Endpoint.protocol}://`

  return `${protocol}${l4EndpointToString(l4Endpoint)}`
}

/**
 * Stringifies a L7 endpoint object into a string.
 *
 * The result format is:
 * - `appProtocol://[endpoint]:port[/path]` for IPv6;
 * - `appProtocol://endpoint:port[/path]` for IPv4 and hostname.
 *
 * @param l7Endpoint The L7 endpoint object to stringify.
 * @returns The string representation of the L7 endpoint.
 */
export function l7EndpointToString(l7Endpoint: network.L7Endpoint): string {
  const protocol = `${l7Endpoint.appProtocol}://`

  let endpoint = l4EndpointToString(l7Endpoint)

  if (l7Endpoint.path) {
    endpoint += `/${l7Endpoint.path}`
  }

  return `${protocol}${endpoint}`
}

/**
 * Stringifies any L3, L4, or L7 endpoint object into a string.
 * The result format depends on the endpoint level at runtime.
 *
 * @param endpoint The endpoint object to stringify.
 * @returns The string representation of the endpoint.
 */
export function endpointToString(endpoint: network.L3Endpoint): string {
  switch (endpoint.level) {
    case 3:
      return l3EndpointToString(endpoint)
    case 4:
      return l4EndpointToString(endpoint)
    case 7:
      return l7EndpointToString(endpoint)
  }
}

const L34_ENDPOINT_RE =
  /^(?:(?<protocol>[a-z]+):\/\/)?(?:(?:\[?(?<ipv6>[0-9A-Fa-f:]+)\]?)|(?<ipv4>(?:\d{1,3}\.){3}\d{1,3})|(?<hostname>[a-zA-Z0-9-*]+(?:\.[a-zA-Z0-9-*]+)*))(?::(?<port>\d{1,5}))?$/

const L7_ENDPOINT_RE =
  /^(?<appProtocol>[a-z]+):\/\/(?:(?:\[?(?<ipv6>[0-9A-Fa-f:]+)\]?)|(?<ipv4>(?:\d{1,3}\.){3}\d{1,3})|(?<hostname>[a-zA-Z0-9-*]+(?:\.[a-zA-Z0-9-*]+)*))(?::(?<port>\d{1,5}))?(?:\/(?<path>.*))?$/

/**
 * Checks if the given endpoint meets the minimum level requirement.
 *
 * @param endpoint The endpoint to check.
 * @param minLevel The minimum level of the endpoint to check.
 * @returns True if the endpoint meets the minimum level requirement, false otherwise.
 */
export function checkEndpointLevel<TMinLevel extends network.EndpointLevel>(
  endpoint: network.L3Endpoint,
  minLevel: TMinLevel,
): endpoint is network.EndpointByMinLevel<TMinLevel> {
  return endpoint.level >= minLevel
}

/**
 * Asserts that the given endpoint meets the minimum level requirement.
 *
 * @param endpoint The endpoint to check.
 * @param minLevel The minimum level of the endpoint to check.
 * @throws If the endpoint does not meet the minimum level requirement.
 */
export function assertEndpointLevel<TMinLevel extends network.EndpointLevel>(
  endpoint: network.L3Endpoint,
  minLevel: TMinLevel,
): asserts endpoint is network.EndpointByMinLevel<TMinLevel> {
  if (!checkEndpointLevel(endpoint, minLevel)) {
    throw new Error(
      `The endpoint "${endpointToString(endpoint)}" is L${endpoint.level}, but L${minLevel} is required`,
    )
  }
}

/**
 * Parses an endpoint from a string.
 * If endpoint object is provided, it is returned as is.
 *
 * Supports L3, L4, and L7 endpoints.
 *
 * - L3 format: `endpoint`
 * - L4 format: `[protocol://]endpoint[:port]`
 * - L7 format: `appProtocol://endpoint[:port][/path]`
 *
 * @param endpoint The endpoint string or object to parse.
 * @param minLevel The minimum level of the endpoint to parse. If provided, ensures the returned endpoint is at least this level.
 * @returns The parsed endpoint object.
 */
export function parseEndpoint<TMinLevel extends network.EndpointLevel = 3>(
  endpoint: InputEndpoint,
  minLevel: TMinLevel = 3 as TMinLevel,
): network.EndpointByMinLevel<TMinLevel> {
  if (typeof endpoint === "object") {
    assertEndpointLevel(endpoint, minLevel)

    return endpoint
  }

  const l7Match = endpoint.match(L7_ENDPOINT_RE)
  if (l7Match) {
    const { appProtocol, ipv6, ipv4, hostname, port, path } = l7Match.groups!
    const udpAppProtocols = ["dns", "dhcp"]

    const resEndpoint: network.L7Endpoint = {
      type: ipv6 ? "ipv6" : ipv4 ? "ipv4" : "hostname",
      level: 7,
      labels: extractAddressLabels(ipv6 || ipv4),
      address: ipv6 || ipv4,
      hostname: hostname,

      // Default port for L7 endpoints (TODO: add more specific defaults for common protocols)
      port: port ? parseInt(port, 10) : 443,

      // L7 endpoints typically use TCP, but can also use UDP for specific protocols
      protocol: udpAppProtocols.includes(appProtocol) ? "udp" : "tcp",

      appProtocol,
      path: path || "",
    }

    const result = network.l7EndpointEntity.schema.safeParse(resEndpoint)
    if (!result.success) {
      throw new Error(`Invalid L7 endpoint "${endpoint}": ${result.error.message}`)
    }

    return result.data
  }

  const l34Match = endpoint.match(L34_ENDPOINT_RE)
  if (!l34Match) {
    throw new Error(`Invalid endpoint: "${endpoint}"`)
  }

  const { protocol, ipv6, ipv4, hostname, port } = l34Match.groups!

  if (protocol && protocol !== "tcp" && protocol !== "udp") {
    throw new Error(`Invalid L4 endpoint protocol: "${protocol}"`)
  }

  if (port) {
    const portNumber = parseInt(port, 10)

    const resEndpoint: network.L4Endpoint = {
      type: ipv6 ? "ipv6" : ipv4 ? "ipv4" : "hostname",
      level: 4,
      labels: extractAddressLabels(ipv6 || ipv4),
      address: ipv6 || ipv4,
      hostname: hostname,
      port: portNumber,
      protocol: protocol ? (protocol as network.L4Protocol) : "tcp",
    }

    const result = network.l4EndpointEntity.schema.safeParse(resEndpoint)
    if (!result.success) {
      throw new Error(`Invalid L4 endpoint "${endpoint}": ${result.error.message}`)
    }

    assertEndpointLevel(result.data, minLevel)

    return result.data
  }

  const resEndpoint: network.L3Endpoint = {
    type: ipv6 ? "ipv6" : ipv4 ? "ipv4" : "hostname",
    level: 3,
    labels: extractAddressLabels(ipv6 || ipv4),
    address: ipv6 || ipv4,
    hostname: hostname,
  }

  const result = network.l3EndpointEntity.schema.safeParse(resEndpoint)
  if (!result.success) {
    throw new Error(`Invalid L3 endpoint "${endpoint}": ${result.error.message}`)
  }

  assertEndpointLevel(result.data, minLevel)

  return result.data
}

const IPV4_PRIVATE_REGEX =
  /^(?:10|127)(?:\.\d{1,3}){3}$|^(?:172\.1[6-9]|172\.2[0-9]|172\.3[0-1])(?:\.\d{1,3}){2}$|^(?:192\.168)(?:\.\d{1,3}){2}$/

const IPV6_PRIVATE_REGEX =
  /^(?:fc|fd)(?:[0-9a-f]{2}){0,2}::(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$|^::(?:ffff:(?:10|127)(?:\.\d{1,3}){3}|(?:172\.1[6-9]|172\.2[0-9]|172\.3[0-1])(?:\.\d{1,3}){2}|(?:192\.168)(?:\.\d{1,3}){2})$/

/**
 * Converts L3 endpoint to L4 endpoint by adding a port and protocol.
 *
 * @param l3Endpoint The L3 endpoint to convert.
 * @param port The port to add to the L3 endpoint.
 * @param protocol The protocol to add to the L3 endpoint. Defaults to "tcp".
 * @returns The L4 endpoint with the port and protocol added.
 */
export function l3EndpointToL4(
  l3Endpoint: InputEndpoint,
  port: number,
  protocol: network.L4Protocol = "tcp",
): network.L4Endpoint {
  const parsed = parseEndpoint(l3Endpoint)

  return {
    ...parsed,
    level: 4,
    port,
    protocol,
  }
}

/**
 * Converts L4 endpoint to L7 endpoint by adding application protocol and path.
 *
 * @param l4Endpoint The L4 endpoint to convert.
 * @param appProtocol The application protocol to add to the L4 endpoint.
 * @param path The path to add to the L4 endpoint. Defaults to an empty string.
 * @returns The L7 endpoint with the application protocol and path added.
 */
export function l4EndpointToL7(
  l4Endpoint: InputEndpoint,
  appProtocol: string,
  path: string = "",
): network.L7Endpoint {
  const parsed = parseEndpoint(l4Endpoint, 4)

  return {
    ...parsed,
    level: 7,
    appProtocol,
    path,
  }
}

/**
 * Converts a L3 endpoint to CIDR notation.
 *
 * If the endpoint is a hostname, an error is thrown.
 *
 * @param endpoint The L3 endpoint to convert.
 * @returns The CIDR notation of the L3 endpoint.
 */
export function l3EndpointToCidr(endpoint: network.L3Endpoint): string {
  switch (endpoint.type) {
    case "ipv4":
      return `${endpoint.address}/32`
    case "ipv6":
      return `${endpoint.address}/128`
    case "hostname":
      throw new Error("Cannot convert hostname to CIDR")
  }
}

function extractAddressLabels(address?: string): Record<string, LabelValue> | undefined {
  if (!address) {
    return undefined
  }

  const labels: Labels = {}

  if (IPV4_PRIVATE_REGEX.test(address) || IPV6_PRIVATE_REGEX.test(address)) {
    labels["iana.scope"] = "private"
  } else {
    labels["iana.scope"] = "global"
  }

  return labels
}

/**
 * Updates the endpoints based on the given mode.
 *
 * @param currentEndpoints The current endpoints to update.
 * @param endpoints The new endpoints to add in string format.
 * @param inputEndpoints The input endpoints to add in object format.
 * @param mode The mode to use when updating the endpoints. Can be "replace" or "prepend". Defaults to "prepend".
 * @returns The updated list of endpoints with duplicates removed.
 */
export async function updateEndpoints<TMinLevel extends network.EndpointLevel = 3>(
  currentEndpoints: Input<network.L3Endpoint[]>,
  endpoints: string[] | undefined,
  inputEndpoints: Input<network.L3Endpoint[]> | undefined,
  mode: ArrayPatchMode = "prepend",
  minLevel: TMinLevel = 3 as TMinLevel,
): Promise<network.L3Endpoint[]> {
  const resolvedCurrentEndpoints = await toPromise(currentEndpoints)
  const newEndpoints = await parseEndpoints(endpoints, inputEndpoints, minLevel)

  if (mode === "replace") {
    return newEndpoints
  }

  return uniqueBy([...newEndpoints, ...resolvedCurrentEndpoints], endpointToString)
}

/**
 * Parses multiple endpoints from strings and input objects.
 *
 * @param endpoints The endpoint strings to parse.
 * @param inputEndpoints The input endpoint objects to use.
 * @returns The parsed list of endpoint objects with duplicates removed.
 */
export async function parseEndpoints<TMinLevel extends network.EndpointLevel = 3>(
  endpoints: string[] | undefined,
  inputEndpoints: Input<network.L3Endpoint[]> | undefined,
  minLevel: TMinLevel = 3 as TMinLevel,
): Promise<network.L3Endpoint[]> {
  const resolvedInputEndpoints = await toPromise(inputEndpoints ?? [])

  return pipe(
    [...(endpoints ?? []), ...resolvedInputEndpoints],
    map(endpoint => parseEndpoint(endpoint, minLevel)),
    uniqueBy(endpointToString),
  )
}

/**
 * Filters the given L3 endpoints by the given label expression.
 *
 * Besides the labels, the following additional labels are available for filtering:
 *
 * - `type`: The type of the endpoint (`ipv4`, `ipv6`, `hostname`).
 * - `level`: The level of the endpoint in the network stack (`3`, `4`, `7`). Numeric, can be used in expressions like `level >= 4`.
 * - `protocol`: The L4 protocol of the endpoint (`tcp`, `udp`). Only available for L4 and L7 endpoints.
 * - `port`: The port of the endpoint. Only available for L4 and L7 endpoints.
 * - `appProtocol`: The application protocol of the endpoint (e.g., `http`, `https`, `dns`). Only available for L7 endpoints.
 *
 * @param endpoints The list of L3 endpoints to filter.
 * @param expression The label expression to filter by.
 * @returns The filtered list of L3 endpoints.
 */
export function filterEndpoints<TEndpoint extends network.L3Endpoint>(
  endpoints: TEndpoint[],
  expression: string,
): TEndpoint[] {
  return filterByLabels(endpoints, expression, endpoint => ({
    ...endpoint.labels,
    type: endpoint.type,
    level: endpoint.level,
    protocol: endpoint.level === 4 || endpoint.level === 7 ? endpoint.protocol : undefined,
    port: endpoint.level === 4 || endpoint.level === 7 ? endpoint.port : undefined,
    appProtocol: endpoint.level === 7 ? endpoint.appProtocol : undefined,
  }))
}
