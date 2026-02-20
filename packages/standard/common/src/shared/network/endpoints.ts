import { check } from "@highstate/contract"
import { type Metadata, metadataSchema, network } from "@highstate/library"
import { type InputArray, toPromise } from "@highstate/pulumi"
import { filter, isNonNullish, map, omit, pipe, uniqueBy } from "remeda"
import { doesAddressBelongToSubnet, parseAddress } from "./address"
import { privateSubnets } from "./subnet"

/**
 * The input L3, L4, or L7 endpoint for some service.
 *
 * Can be provided as a string or an object.
 */
export type InputEndpoint = network.L3Endpoint | network.Address | string

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
      return l3Endpoint.address.value
    case "ipv6":
      return l3Endpoint.address.value
    case "hostname":
      return l3Endpoint.hostname
  }
}

/**
 * Stringifies a L4 endpoint object into a string.
 *
 * The result format is `endpoint:port` for IPv4 and hostname, and `[endpoint]:port` for IPv6.
 *
 * @param l4Endpoint The L4 endpoint object to stringify.
 * @returns The string representation of the L4 endpoint.
 */
export function l4EndpointToString(l4Endpoint: network.L3Endpoint & { port: number }): string {
  const host = l3EndpointToString(l4Endpoint)
  const wrappedHost = l4Endpoint.type === "ipv6" ? `[${host}]` : host

  return `${wrappedHost}:${l4Endpoint.port}`
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
export function l7EndpointToString(
  l7Endpoint: network.L3Endpoint & {
    level: 7
    appProtocol: string
    port: number
    path?: string | undefined
  },
): string {
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
  type L3EndpointBase =
    | {
        type: "hostname"
        level: 3
        hostname: string
        metadata: network.L3Endpoint["metadata"]
      }
    | {
        type: "ipv4" | "ipv6"
        level: 3
        metadata: network.L3Endpoint["metadata"]
        address: network.Address
        subnet: network.Subnet
      }

  function validateEndpoint<TEndpoint extends network.L3Endpoint>(value: TEndpoint): TEndpoint {
    const schema =
      value.level === 7
        ? network.l7EndpointEntity.schema
        : value.level === 4
          ? network.l4EndpointEntity.schema
          : network.l3EndpointEntity.schema

    const result = schema.safeParse(value)
    if (!result.success) {
      throw new Error(`Invalid endpoint "${endpointToString(value)}": ${result.error.message}`)
    }

    // Important: Zod strips unknown keys by default.
    // We validate here, but return the original value to preserve fields
    // that are not part of the schema (e.g., dynamic.endpoint mirroring).
    return value
  }

  function parseHostToL3(host: string): L3EndpointBase {
    const trimmed = host.trim()
    if (!trimmed) {
      throw new Error("Empty endpoint host")
    }

    try {
      const address = parseAddress(trimmed)

      return {
        type: address.type,
        level: 3,
        metadata: extractMetadata(address),
        address,
        subnet: address.subnet,
      }
    } catch {
      return {
        type: "hostname",
        level: 3,
        hostname: trimmed,
        metadata: {},
      }
    }
  }

  function splitHostPort(input: string): { host: string; port?: number } {
    const trimmed = input.trim()

    if (!trimmed) {
      throw new Error("Empty endpoint")
    }

    if (trimmed.startsWith("[")) {
      const closingIndex = trimmed.indexOf("]")
      if (closingIndex === -1) {
        throw new Error(`Invalid endpoint: "${input}"`)
      }

      const host = trimmed.slice(1, closingIndex)
      const remainder = trimmed.slice(closingIndex + 1)

      if (!remainder) {
        return { host }
      }

      if (!remainder.startsWith(":")) {
        throw new Error(`Invalid endpoint: "${input}"`)
      }

      const portString = remainder.slice(1)
      if (!/^\d{1,5}$/.test(portString)) {
        throw new Error(`Invalid endpoint port: "${portString}"`)
      }

      return { host, port: parseInt(portString, 10) }
    }

    const lastColonIndex = trimmed.lastIndexOf(":")
    if (lastColonIndex === -1) {
      return { host: trimmed }
    }

    // If it looks like an IPv6 address without brackets, treat it as host-only.
    if (trimmed.includes(":")) {
      const firstColonIndex = trimmed.indexOf(":")
      if (firstColonIndex !== lastColonIndex) {
        return { host: trimmed }
      }
    }

    const host = trimmed.slice(0, lastColonIndex)
    const portString = trimmed.slice(lastColonIndex + 1)
    if (!/^\d{1,5}$/.test(portString)) {
      return { host: trimmed }
    }

    return { host, port: parseInt(portString, 10) }
  }

  if (check(network.l3EndpointEntity.schema, endpoint)) {
    assertEndpointLevel(endpoint, minLevel)

    return endpoint as network.EndpointByMinLevel<TMinLevel>
  }

  if (check(network.addressEntity.schema, endpoint)) {
    const address = endpoint
    const built: network.L3Endpoint = {
      type: address.type,
      level: 3,
      metadata: extractMetadata(address),
      address,
      subnet: address.subnet,
    }

    const validated = validateEndpoint(built)

    assertEndpointLevel(validated, minLevel)
    return validated as network.EndpointByMinLevel<TMinLevel>
  }

  if (typeof endpoint !== "string") {
    throw new Error("Invalid endpoint")
  }

  const endpointString = endpoint

  let builtEndpoint: network.L3Endpoint

  const schemeMatch = /^([a-z]+):\/\/(.*)$/.exec(endpointString)
  if (schemeMatch) {
    const appProtocol = schemeMatch[1]
    const rest = schemeMatch[2]

    const pathIndex = rest.indexOf("/")
    const hostPortPart = pathIndex === -1 ? rest : rest.slice(0, pathIndex)
    const path = pathIndex === -1 ? undefined : rest.slice(pathIndex + 1)

    const udpAppProtocols = ["dns", "dhcp"]
    const { host, port } = splitHostPort(hostPortPart)
    const l3Base = parseHostToL3(host)

    const portNumber = port ?? 443
    const protocol: network.L4Protocol = udpAppProtocols.includes(appProtocol) ? "udp" : "tcp"

    builtEndpoint =
      l3Base.type === "hostname"
        ? {
            ...l3Base,
            level: 7,
            port: portNumber,
            protocol,
            appProtocol,
            path: path || undefined,
          }
        : {
            ...l3Base,
            level: 7,
            port: portNumber,
            protocol,
            appProtocol,
            path: path || undefined,
          }
  } else {
    const { host, port } = splitHostPort(endpointString)
    const l3Base = parseHostToL3(host)

    if (port !== undefined) {
      builtEndpoint =
        l3Base.type === "hostname"
          ? {
              ...l3Base,
              level: 4,
              port,
              protocol: "tcp",
            }
          : {
              ...l3Base,
              level: 4,
              port,
              protocol: "tcp",
            }
    } else {
      builtEndpoint = l3Base
    }
  }

  const validated = validateEndpoint(builtEndpoint)

  assertEndpointLevel(validated, minLevel)
  return validated as network.EndpointByMinLevel<TMinLevel>
}

/**
 * Parses L4 protocol from string.
 *
 * @param input The input string to parse.
 * @returns The parsed L4 protocol.
 */
export function parseL4Protocol(input: string): network.L4Protocol {
  input = input.trim().toLowerCase()

  if (input === "tcp" || input === "udp") {
    return input
  }

  throw new Error(`Invalid L4 protocol: "${input}"`)
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
  } as network.L4Endpoint
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
      return `${endpoint.address.value}/32`
    case "ipv6":
      return `${endpoint.address.value}/128`
    case "hostname":
      throw new Error("Cannot convert hostname to CIDR")
  }
}

function extractMetadata(address?: network.Address): network.L3Endpoint["metadata"] {
  if (!address) {
    return {}
  }

  const metadata: network.L3Endpoint["metadata"] = {}

  if (privateSubnets.some(subnet => doesAddressBelongToSubnet(address, subnet))) {
    metadata["iana.scope"] = "private"
  } else {
    metadata["iana.scope"] = "global"
  }

  return metadata
}

/**
 * Parses multiple endpoints from strings and input objects.
 *
 * @param endpoints The endpoint strings to parse.
 * @param inputEndpoints The input endpoint objects to use.
 * @returns The parsed list of endpoint objects with duplicates removed.
 */
export async function parseEndpoints<TMinLevel extends network.EndpointLevel = 3>(
  endpoints: (string | undefined | null)[] | null | undefined,
  inputEndpoints: InputArray<network.L3Endpoint | undefined | null> | null | undefined,
  minLevel: TMinLevel = 3 as TMinLevel,
): Promise<network.EndpointByMinLevel<TMinLevel>[]> {
  const resolvedInputEndpoints = await toPromise(inputEndpoints ?? [])

  return pipe(
    [...(endpoints ?? []), ...resolvedInputEndpoints],
    filter(isNonNullish),
    map(endpoint => parseEndpoint(endpoint, minLevel)),
    uniqueBy(endpointToString),
  )
}

/**
 * Adds the given metadata to the endpoint.
 *
 * @param endpoint The endpoint to add metadataa to.
 * @param newMetadata The metadata to add to the endpoint.
 * @returns The endpoint with the added metadata.
 */
export function addEndpointMetadata<
  TEndpoint extends network.L3Endpoint,
  TMetadata extends Metadata,
>(endpoint: TEndpoint, newMetadata: TMetadata): TEndpoint & { metadata: TMetadata } {
  const parsedMetadata = metadataSchema.safeParse(newMetadata)
  if (!parsedMetadata.success) {
    throw new Error(
      `Invalid new metadata for endpoint "${endpointToString(endpoint)}": ${parsedMetadata.error.message}`,
    )
  }

  return {
    ...endpoint,
    metadata: {
      ...endpoint.metadata,
      ...newMetadata,
    },
  }
}

/**
 * Merges duplicate endpoints by combining their metadata.
 *
 * @param endpoints The list of endpoints to merge.
 * @returns The merged list of endpoints with duplicates removed and metadata combined.
 */
export function mergeEndpoints<TEndpoint extends network.L3Endpoint>(
  endpoints: TEndpoint[],
): TEndpoint[] {
  const mergedMap = new Map<string, TEndpoint>()

  for (const endpoint of endpoints) {
    const key = endpointToString(endpoint)
    const existing = mergedMap.get(key)

    if (existing) {
      mergedMap.set(key, addEndpointMetadata(existing, endpoint.metadata ?? {}))
    } else {
      mergedMap.set(key, endpoint)
    }
  }

  return Array.from(mergedMap.values())
}

/**
 * Replaces the base (host) of an endpoint with another endpoint's base.
 *
 * This function can be used to "re-host" an endpoint while keeping its other properties.
 * For example, you can take an existing L7 endpoint and replace its host with a DNS record name.
 *
 * If the base is a hostname, the result becomes a hostname endpoint.
 * If the base is an IP address, the result becomes an IP endpoint of the base's version.
 *
 * The base properties are:
 * - For hostname endpoints: `type: "hostname"` and `hostname`
 * - For IP address endpoints: `type`, `address`, `subnet`, and `metadata`
 *
 * Note: This intentionally may change the endpoint kind (hostname ↔ ip) and IP version (ipv4 ↔ ipv6).
 *
 * @param endpoint The endpoint to replace the base properties of.
 * @param base The endpoint to take the base properties from.
 * @returns The endpoint with the replaced base properties.
 */
export function rebaseEndpoint<TEndpoint extends network.L3Endpoint>(
  endpoint: TEndpoint,
  base: network.L3Endpoint,
): TEndpoint {
  if (base.type === "hostname") {
    return {
      ...omit(endpoint, ["type", "address", "subnet"]),
      type: "hostname",
      hostname: base.hostname,
      port: base.port ?? endpoint.port,
    } as TEndpoint
  }

  return {
    ...omit(endpoint, ["type", "hostname"]),
    type: base.type,
    address: base.address,
    subnet: base.subnet,
    port: base.port ?? endpoint.port,
    metadata: {
      ...endpoint.metadata,
      ...extractMetadata(base.address),
    },
  } as TEndpoint
}
