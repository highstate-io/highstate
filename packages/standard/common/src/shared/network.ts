import type { ArrayPatchMode, network } from "@highstate/library"
import { type Input, toPromise } from "@highstate/pulumi"
import { uniqueBy } from "remeda"

/**
 * The L3 or L4 endpoint for some service.
 *
 * The format is: `[protocol://]endpoint[:port]`
 */
export type InputL34Endpoint = network.L34Endpoint | string

/**
 * The L3 endpoint for some service.
 */
export type InputL3Endpoint = network.L3Endpoint | string

/**
 * The L4 endpoint for some service.
 */
export type InputL4Endpoint = network.L4Endpoint | string

/**
 * The L7 endpoint for some service.
 *
 * The format is: `appProtocol://endpoint[:port][/resource]`
 */
export type InputL7Endpoint = network.L7Endpoint | string

/**
 * Stringifies a L3 endpoint object into a string.
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
 * @param l4Endpoint The L4 endpoint object to stringify.
 * @returns The string representation of the L4 endpoint with protocol.
 */
export function l4EndpointWithProtocolToString(l4Endpoint: network.L4Endpoint): string {
  const protocol = `${l4Endpoint.protocol}://`

  return `${protocol}${l4EndpointToString(l4Endpoint)}`
}

/**
 * Stringifies a L7 endpoint object into a string.
 *
 * The format is: `appProtocol://endpoint[:port][/resource]`
 * @param l7Endpoint The L7 endpoint object to stringify.
 * @returns The string representation of the L7 endpoint.
 */
export function l7EndpointToString(l7Endpoint: network.L7Endpoint): string {
  const protocol = `${l7Endpoint.appProtocol}://`

  let endpoint = l4EndpointToString(l7Endpoint)

  if (l7Endpoint.resource) {
    endpoint += `/${l7Endpoint.resource}`
  }

  return `${protocol}${endpoint}`
}

/**
 * Stringifies a L3 or L4 endpoint object into a string.
 *
 * @param l34Endpoint The L3 or L4 endpoint object to stringify.
 * @returns The string representation of the L3 or L4 endpoint.
 */
export function l34EndpointToString(l34Endpoint: network.L34Endpoint): string {
  if (l34Endpoint.port) {
    return l4EndpointToString(l34Endpoint)
  }

  return l3EndpointToString(l34Endpoint)
}

const L34_ENDPOINT_RE =
  /^(?:(?<protocol>[a-z]+):\/\/)?(?:(?:\[?(?<ipv6>[0-9A-Fa-f:]+)\]?)|(?<ipv4>(?:\d{1,3}\.){3}\d{1,3})|(?<hostname>[a-zA-Z0-9-*]+(?:\.[a-zA-Z0-9-*]+)*))(?::(?<port>\d{1,5}))?$/

const L7_ENDPOINT_RE =
  /^(?<appProtocol>[a-z]+):\/\/(?:(?:\[?(?<ipv6>[0-9A-Fa-f:]+)\]?)|(?<ipv4>(?:\d{1,3}\.){3}\d{1,3})|(?<hostname>[a-zA-Z0-9-*]+(?:\.[a-zA-Z0-9-*]+)*))(?::(?<port>\d{1,5}))?(?:\/(?<resource>.*))?$/

/**
 * Parses a L3 or L4 endpoint from a string.
 *
 * The format is `[protocol://]endpoint[:port]`.
 *
 * @param l34Endpoint The L3 or L4 endpoint string to parse.
 * @returns The parsed L3 or L4 endpoint object.
 */
export function parseL34Endpoint(l34Endpoint: InputL34Endpoint): network.L34Endpoint {
  if (typeof l34Endpoint === "object") {
    return l34Endpoint
  }

  const match = l34Endpoint.match(L34_ENDPOINT_RE)
  if (!match) {
    throw new Error(`Invalid L3/L4 endpoint: "${l34Endpoint}"`)
  }

  const { protocol, ipv6, ipv4, hostname, port } = match.groups!

  if (protocol && protocol !== "tcp" && protocol !== "udp") {
    throw new Error(`Invalid L4 endpoint protocol: "${protocol}"`)
  }

  let visibility: network.EndpointVisibility = "public"

  if (ipv4 && IPV4_PRIVATE_REGEX.test(ipv4)) {
    visibility = "external"
  } else if (ipv6 && IPV6_PRIVATE_REGEX.test(ipv6)) {
    visibility = "external"
  }

  const fallbackProtocol = port ? "tcp" : undefined

  return {
    type: ipv6 ? "ipv6" : ipv4 ? "ipv4" : "hostname",
    visibility,
    address: ipv6 || ipv4,
    hostname: hostname,
    port: port ? parseInt(port, 10) : undefined,
    protocol: protocol ? (protocol as network.L4Protocol) : fallbackProtocol,
  } as network.L34Endpoint
}

/**
 * Parses a L3 endpoint from a string.
 *
 * The same as `parseL34Endpoint`, but only for L3 endpoints and will throw an error if the endpoint contains a port.
 *
 * @param l3Endpoint The L3 endpoint string to parse.
 * @returns The parsed L3 endpoint object.
 */
export function parseL3Endpoint(l3Endpoint: InputL3Endpoint): network.L3Endpoint {
  if (typeof l3Endpoint === "object") {
    return l3Endpoint
  }

  const parsed = parseL34Endpoint(l3Endpoint)

  if (parsed.port) {
    throw new Error(`Port cannot be specified in L3 endpoint: "${l3Endpoint}"`)
  }

  return parsed
}

/**
 * Parses a L4 endpoint from a string.
 *
 * The same as `parseL34Endpoint`, but only for L4 endpoints and will throw an error if the endpoint does not contain a port.
 */
export function parseL4Endpoint(l4Endpoint: InputL4Endpoint): network.L4Endpoint {
  if (typeof l4Endpoint === "object") {
    return l4Endpoint
  }

  const parsed = parseL34Endpoint(l4Endpoint)

  if (!parsed.port) {
    throw new Error(`No port found in L4 endpoint: "${l4Endpoint}"`)
  }

  return parsed
}

const IPV4_PRIVATE_REGEX =
  /^(?:10|127)(?:\.\d{1,3}){3}$|^(?:172\.1[6-9]|172\.2[0-9]|172\.3[0-1])(?:\.\d{1,3}){2}$|^(?:192\.168)(?:\.\d{1,3}){2}$/

const IPV6_PRIVATE_REGEX =
  /^(?:fc|fd)(?:[0-9a-f]{2}){0,2}::(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$|^::(?:ffff:(?:10|127)(?:\.\d{1,3}){3}|(?:172\.1[6-9]|172\.2[0-9]|172\.3[0-1])(?:\.\d{1,3}){2}|(?:192\.168)(?:\.\d{1,3}){2})$/

/**
 * Helper function to get the input L3 endpoint from the raw endpoint or input endpoint.
 *
 * If neither is provided, an error is thrown.
 *
 * @param rawEndpoint The raw endpoint string to parse.
 * @param inputEndpoint The input endpoint object to use if the raw endpoint is not provided.
 * @returns The parsed L3 endpoint object.
 */
export async function requireInputL3Endpoint(
  rawEndpoint: string | undefined,
  inputEndpoint: Input<network.L3Endpoint> | undefined,
): Promise<network.L3Endpoint> {
  if (rawEndpoint) {
    return parseL3Endpoint(rawEndpoint)
  }

  if (inputEndpoint) {
    return toPromise(inputEndpoint)
  }

  throw new Error("No endpoint provided")
}

/**
 * Helper function to get the input L4 endpoint from the raw endpoint or input endpoint.
 *
 * If neither is provided, an error is thrown.
 *
 * @param rawEndpoint The raw endpoint string to parse.
 * @param inputEndpoint The input endpoint object to use if the raw endpoint is not provided.
 * @returns The parsed L4 endpoint object.
 */
export async function requireInputL4Endpoint(
  rawEndpoint: string | undefined,
  inputEndpoint: Input<network.L4Endpoint> | undefined,
): Promise<network.L4Endpoint> {
  if (rawEndpoint) {
    return parseL4Endpoint(rawEndpoint)
  }

  if (inputEndpoint) {
    return toPromise(inputEndpoint)
  }

  throw new Error("No endpoint provided")
}

/**
 * Converts L3 endpoint to L4 endpoint by adding a port and protocol.
 *
 * @param l3Endpoint The L3 endpoint to convert.
 * @param port The port to add to the L3 endpoint.
 * @param protocol The protocol to add to the L3 endpoint. Defaults to "tcp".
 * @returns The L4 endpoint with the port and protocol added.
 */
export function l3EndpointToL4(
  l3Endpoint: InputL3Endpoint,
  port: number,
  protocol: network.L4Protocol = "tcp",
): network.L4Endpoint {
  return {
    ...parseL3Endpoint(l3Endpoint),
    port,
    protocol,
  }
}

/**
 * Filters the endpoints based on the given filter.
 *
 * @param endpoints The list of endpoints to filter.
 * @param filter The filter to apply. If not provided, the endpoints will be filtered by the most accessible type: `public` > `external` > `internal`.
 * @param types The list of endpoint types to filter by. If provided, only endpoints of these types will be returned.
 *
 * @returns The filtered list of endpoints.
 */
export function filterEndpoints<
  TEndpoint extends network.L34Endpoint,
  TType extends network.L34Endpoint["type"],
>(
  endpoints: TEndpoint[],
  filter?: network.EndpointFilter,
  types?: TType[],
): (TEndpoint & { type: TType })[] {
  if (filter?.length) {
    endpoints = endpoints.filter(endpoint => filter.includes(endpoint.visibility))
  } else if (endpoints.some(endpoint => endpoint.visibility === "public")) {
    endpoints = endpoints.filter(endpoint => endpoint.visibility === "public")
  } else if (endpoints.some(endpoint => endpoint.visibility === "external")) {
    endpoints = endpoints.filter(endpoint => endpoint.visibility === "external")
  }

  if (types?.length) {
    endpoints = endpoints.filter(endpoint => types.includes(endpoint.type as TType))
  }

  return endpoints as (TEndpoint & { type: TType })[]
}

/**
 * Converts a L3 endpoint to CIDR notation.
 *
 * If the endpoint is a hostname, an error is thrown.
 *
 * @param l3Endpoint The L3 endpoint to convert.
 * @returns The CIDR notation of the L3 endpoint.
 */
export function l3EndpointToCidr(l3Endpoint: network.L3Endpoint): string {
  switch (l3Endpoint.type) {
    case "ipv4":
      return `${l3Endpoint.address}/32`
    case "ipv6":
      return `${l3Endpoint.address}/128`
    case "hostname":
      throw new Error("Cannot convert hostname to CIDR")
  }
}

const udpAppProtocols = ["dns", "dhcp"]

/**
 * Parses a L7 endpoint from a string.
 *
 * The format is: `appProtocol://endpoint[:port][/resource]`
 *
 * @param l7Endpoint The L7 endpoint string to parse.
 * @returns The parsed L7 endpoint object.
 */
export function parseL7Endpoint(l7Endpoint: InputL7Endpoint): network.L7Endpoint {
  if (typeof l7Endpoint === "object") {
    return l7Endpoint
  }

  const match = l7Endpoint.match(L7_ENDPOINT_RE)
  if (!match) {
    throw new Error(`Invalid L7 endpoint: "${l7Endpoint}"`)
  }

  const { appProtocol, ipv6, ipv4, hostname, port, resource } = match.groups!

  let visibility: network.EndpointVisibility = "public"

  if (ipv4 && IPV4_PRIVATE_REGEX.test(ipv4)) {
    visibility = "external"
  } else if (ipv6 && IPV6_PRIVATE_REGEX.test(ipv6)) {
    visibility = "external"
  }

  return {
    type: ipv6 ? "ipv6" : ipv4 ? "ipv4" : "hostname",
    visibility,
    address: ipv6 || ipv4,
    hostname: hostname,

    // Default port for L7 endpoints (TODO: add more specific defaults for common protocols)
    port: port ? parseInt(port, 10) : 443,

    // L7 endpoints typically use TCP, but can also use UDP for specific protocols
    protocol: udpAppProtocols.includes(appProtocol) ? "udp" : "tcp",

    appProtocol,
    resource: resource || "",
  } as network.L7Endpoint
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
export async function updateEndpoints<TEndpoints extends network.L34Endpoint>(
  currentEndpoints: Input<TEndpoints[]>,
  endpoints: string[] | undefined,
  inputEndpoints: Input<TEndpoints[]> | undefined,
  mode: ArrayPatchMode = "prepend",
): Promise<TEndpoints[]> {
  const resolvedCurrentEndpoints = await toPromise(currentEndpoints)
  const newEndpoints = await parseEndpoints(endpoints, inputEndpoints)

  if (mode === "replace") {
    return newEndpoints as TEndpoints[]
  }

  return uniqueBy(
    [...newEndpoints, ...resolvedCurrentEndpoints],
    l34EndpointToString,
  ) as TEndpoints[]
}

/**
 * Parses a list of endpoints from strings and input objects.
 *
 * @param endpoints The list of endpoint strings to parse.
 * @param inputEndpoints The list of input endpoint objects to use.
 * @returns The parsed list of endpoint objects with duplicates removed.
 */
export async function parseEndpoints<TEndpoints extends network.L34Endpoint>(
  endpoints: string[] | undefined,
  inputEndpoints: Input<TEndpoints[]> | undefined,
): Promise<TEndpoints[]> {
  const resolvedInputEndpoints = await toPromise(inputEndpoints)

  return uniqueBy(
    [...(endpoints?.map(parseL34Endpoint) ?? []), ...(resolvedInputEndpoints ?? [])],
    l34EndpointToString,
  ) as TEndpoints[]
}
