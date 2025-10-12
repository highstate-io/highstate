import type { ArrayPatchMode, dns, network } from "@highstate/library"
import { getOrCreate, z } from "@highstate/contract"
import {
  ComponentResource,
  type Input,
  type InputArray,
  type InputOrArray,
  interpolate,
  normalizeInputsAndMap,
  type Output,
  output,
  type ResourceOptions,
  toPromise,
  type Unwrap,
} from "@highstate/pulumi"
import { flat, groupBy, uniqueBy } from "remeda"
import { Command, type CommandHost } from "./command"
import { ImplementationMediator } from "./impl-ref"
import {
  filterEndpoints,
  type InputL3Endpoint,
  l3EndpointToString,
  l34EndpointToString,
  parseL3Endpoint,
} from "./network"

export const dnsRecordMediator = new ImplementationMediator(
  "dns-record",
  z.object({ name: z.string(), args: z.custom<ResolvedDnsRecordArgs>() }),
  z.instanceof(ComponentResource),
)

export type DnsRecordArgs = {
  /**
   * The DNS provider to use.
   */
  provider: Input<dns.Provider>

  /**
   * The name of the DNS record.
   * If not provided, the name of the resource will be used.
   */
  name?: Input<string>

  /**
   * The type of the DNS record.
   *
   * If not provided, will be automatically detected based on the value.
   */
  type?: Input<string>

  /**
   * The value of the DNS record.
   */
  value: Input<InputL3Endpoint>

  /**
   * Whether the DNS record is proxied (e.g. to provide DDoS protection).
   *
   * Available only for public IPs and some DNS providers like Cloudflare.
   * If not supported, the DNS provider will ignore this value.
   */
  proxied?: Input<boolean>

  /**
   * The TTL of the DNS record.
   *
   * If not provided, the DNS provider will use its default value.
   */
  ttl?: Input<number>

  /**
   * The priority of the DNS record.
   *
   * Only used for some DNS record types (e.g. MX).
   */
  priority?: Input<number>

  /**
   * Wait for the DNS record to be created/updated at the specified environment(s) before continuing.
   */
  waitAt?: InputOrArray<CommandHost>
}

export type ResolvedDnsRecordArgs = Pick<DnsRecordArgs, "name" | "priority" | "ttl" | "proxied"> & {
  /**
   * The value of the DNS record.
   */
  value: Input<string>

  /**
   * The type of the DNS record.
   */
  type: Input<string>
}

export type DnsRecordSetArgs = Omit<DnsRecordArgs, "provider" | "value"> & {
  /**
   * The DNS providers to use to create the DNS records.
   *
   * If multiple providers matched the specified domain, records will be created for each of them.
   */
  providers: Input<dns.Provider[]>

  /**
   * The value of the DNS record.
   */
  value?: Input<InputL3Endpoint>

  /**
   * The values of the DNS records.
   */
  values?: InputArray<InputL3Endpoint>
}

function getTypeByEndpoint(endpoint: network.L3Endpoint): string {
  switch (endpoint.type) {
    case "ipv4":
      return "A"
    case "ipv6":
      return "AAAA"
    case "hostname":
      return "CNAME"
  }
}

/**
 * Creates a DNS record for the specified value and waits for it to be resolved.
 *
 * Uses the specified DNS provider to create the record.
 */
export class DnsRecord extends ComponentResource {
  /**
   * The underlying dns record resource.
   */
  readonly dnsRecord: Output<ComponentResource>

  /**
   * The commands to be executed after the DNS record is created/updated.
   *
   * These commands will wait for the DNS record to be resolved to the specified value.
   */
  readonly waitCommands: Output<Command[]>

  constructor(name: string, args: DnsRecordArgs, opts?: ResourceOptions) {
    super("highstate:common:DnsRecord", name, args, opts)

    const l3Endpoint = output(args.value).apply(value => parseL3Endpoint(value))
    const resolvedValue = l3Endpoint.apply(l3EndpointToString)
    const resolvedType = args.type ? output(args.type) : l3Endpoint.apply(getTypeByEndpoint)

    this.dnsRecord = output(args.provider).apply(provider => {
      return dnsRecordMediator.call(provider.implRef, {
        name,
        args: {
          name: args.name,
          priority: args.priority,
          ttl: args.ttl,
          value: resolvedValue,
          type: resolvedType,
        },
      })
    })

    this.waitCommands = output({
      waitAt: args.waitAt,
      resolvedType,
      proxied: args.proxied,
    }).apply(({ waitAt, resolvedType, proxied }) => {
      if (resolvedType === "CNAME") {
        // TODO: handle CNAME records
        return []
      }

      const resolvedHosts = waitAt ? [waitAt].flat() : []

      if (proxied) {
        // for proxied records do not verify the value since we do not know the actual IP addressa

        return (resolvedHosts as Unwrap<CommandHost>[]).map(host => {
          const hostname = host === "local" ? "local" : host.hostname

          return new Command(
            `${name}.wait-for-dns.${hostname}`,
            {
              host,
              create: [
                interpolate`while ! getent hosts "${args.name}";`,
                interpolate`do echo "Waiting for DNS record \"${args.name}\" to be available...";`,
                `sleep 5;`,
                `done`,
              ],
            },
            { parent: this },
          )
        })
      }

      return (resolvedHosts as Unwrap<CommandHost>[]).map(host => {
        const hostname = host === "local" ? "local" : host.hostname

        return new Command(
          `${name}.wait-for-dns.${hostname}`,
          {
            host,
            create: [
              interpolate`while ! getent hosts "${args.name}" | grep "${resolvedValue}";`,
              interpolate`do echo "Waiting for DNS record \"${args.name}" to resolve to "${resolvedValue}"...";`,
              `sleep 5;`,
              `done`,
            ],
          },
          { parent: this },
        )
      })
    })
  }
}

/**
 * Creates a set of DNS records for the specified values and waits for them to be resolved.
 */
export class DnsRecordSet extends ComponentResource {
  /**
   * The underlying dns record resources.
   */
  readonly dnsRecords: Output<DnsRecord[]>

  /**
   * The flat list of all wait commands for the DNS records.
   */
  readonly waitCommands: Output<Command[]>

  constructor(name: string, args: DnsRecordSetArgs, opts?: ResourceOptions) {
    super("highstate:common:DnsRecordSet", name, args, opts)

    const matchedProviders = output({
      providers: args.providers,
      name: args.name ?? name,
    }).apply(({ providers }) => {
      const matchedProviders = providers.filter(provider => name.endsWith(provider.domain))

      if (matchedProviders.length === 0) {
        throw new Error(`No DNS provider matched the domain "${name}"`)
      }

      return matchedProviders
    })

    this.dnsRecords = normalizeInputsAndMap(args.value, args.values, value => {
      return output({
        name: args.name ?? name,
        providers: matchedProviders,
      }).apply(({ name, providers }) => {
        return providers.flatMap(provider => {
          const l3Endpoint = parseL3Endpoint(value)

          return new DnsRecord(
            `${name}.${provider.id}.${l3EndpointToString(l3Endpoint)}`,
            {
              name,
              provider,
              value: l3Endpoint,
              type: args.type ?? getTypeByEndpoint(l3Endpoint),
              proxied: args.proxied,
              ttl: args.ttl,
              priority: args.priority,
              waitAt: args.waitAt,
            },
            { parent: this },
          )
        })
      })
    }).apply(flat)

    this.waitCommands = this.dnsRecords
      .apply(records => records.flatMap(record => record.waitCommands))
      .apply(flat)
  }

  private static readonly dnsRecordSetCache = new Map<string, DnsRecordSet>()

  /**
   * Creates a DNS record set for the specified endpoints and waits for it to be resolved.
   *
   * If a DNS record set with the same name already exists, it will be reused.
   *
   * @param name The name of the DNS record set.
   * @param args The arguments for the DNS record set.
   * @param opts The options for the resource.
   */
  static createOnce(name: string, args: DnsRecordSetArgs, opts?: ResourceOptions): DnsRecordSet {
    return getOrCreate(
      DnsRecordSet.dnsRecordSetCache,
      name,
      () => new DnsRecordSet(name, args, opts),
    )
  }
}

/**
 * Registers the DNS record set for the given endpoints and prepends the corresponding hostname endpoint to the list.
 *
 * Waits for the DNS record set to be created/updated before continuing.
 *
 * Ignores the "hostname" endpoints in the list.
 *
 * @param endpoints The list of endpoints to register. Will be modified in place.
 * @param fqdn The FQDN to register the DNS record set for. If not provided, no DNS record set will be created and array will not be modified.
 * @param fqdnEndpointFilter The filter to apply to the endpoints before passing them to the DNS record set. Does not apply to the resulted endpoint list.
 * @param dnsProviders The DNS providers to use to create the DNS records.
 */
export async function updateEndpointsWithFqdn<TEndpoint extends network.L34Endpoint>(
  endpoints: Input<TEndpoint[]>,
  fqdn: string | undefined,
  fqdnEndpointFilter: network.EndpointFilter,
  patchMode: ArrayPatchMode,
  dnsProviders: Input<dns.Provider[]>,
): Promise<{ endpoints: TEndpoint[]; dnsRecordSet: DnsRecordSet | undefined }> {
  const resolvedEndpoints = await toPromise(endpoints)

  if (!fqdn) {
    return {
      endpoints: resolvedEndpoints as TEndpoint[],
      dnsRecordSet: undefined,
    }
  }

  const filteredEndpoints = filterEndpoints(resolvedEndpoints, fqdnEndpointFilter)

  const dnsRecordSet = new DnsRecordSet(fqdn, {
    providers: dnsProviders,
    values: filteredEndpoints,
    waitAt: "local",
  })

  const portProtocolGroups = groupBy(filteredEndpoints, endpoint =>
    endpoint.port ? `${endpoint.port}-${endpoint.protocol}` : "",
  )

  const newEndpoints: TEndpoint[] = []

  for (const group of Object.values(portProtocolGroups)) {
    newEndpoints.unshift({
      type: "hostname",
      hostname: fqdn,
      visibility: group[0].visibility,
      port: group[0].port,
      protocol: group[0].protocol,
    } as TEndpoint)
  }

  await toPromise(
    dnsRecordSet.waitCommands.apply(waitCommands => waitCommands.map(command => command.stdout)),
  )

  if (patchMode === "prepend") {
    return {
      endpoints: uniqueBy(
        //
        [...newEndpoints, ...(resolvedEndpoints as TEndpoint[])],
        endpoint => l34EndpointToString(endpoint),
      ),
      dnsRecordSet,
    }
  }

  return {
    endpoints: newEndpoints,
    dnsRecordSet,
  }
}
