import { dnsRecordMediator, type ResolvedDnsRecordArgs } from "@highstate/common"
import { cloudflare } from "@highstate/library"
import { getResourceComment } from "@highstate/pulumi"
import { DnsRecord } from "@pulumi/cloudflare"
import { ComponentResource, type ResourceOptions } from "@pulumi/pulumi"
import { getProvider } from "../provider"

type CloudflareDnsRecordArgs = ResolvedDnsRecordArgs & {
  zoneId: string
}

class CloudflareDnsRecord extends ComponentResource {
  /**
   * The underlying Cloudflare DNS record resource.
   */
  readonly dnsRecord: DnsRecord

  constructor(name: string, args: CloudflareDnsRecordArgs, opts?: ResourceOptions) {
    super("highstate:cloudflare:DnsRecord", name, args, opts)

    this.dnsRecord = new DnsRecord(
      name,
      {
        name: args.name,
        zoneId: args.zoneId,
        type: args.type,
        content: args.value,
        proxied: args.proxied,
        comment: getResourceComment(),
        ttl: args.ttl ?? 1,
        priority: args.priority,
      },
      opts,
    )
  }
}

export const createDnsRecord = dnsRecordMediator.implement(
  cloudflare.providerDataSchema,
  ({ name, args }, data) => {
    const provider = getProvider(data)
    const zoneId = data.zoneIds[args.zone]

    if (!zoneId) {
      throw new Error(
        `The DNS provider "${provider.id}" does not have ID for the zone "${args.zone}". This is not expected, please open an issue.`,
      )
    }

    return new CloudflareDnsRecord(name, { ...args, zoneId }, { provider })
  },
)
