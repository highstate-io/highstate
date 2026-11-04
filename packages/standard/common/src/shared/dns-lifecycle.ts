import type { Input, ResourceOptions } from "@highstate/pulumi"
import { local } from "@pulumi/command"

type DnsRecordFamily = "alias" | "records"

/**
 * A persistent dependency shared by every record in one provider's record set.
 * Replacing this no-op command deletes incompatible records before creating their successors.
 * Use a native provider because dynamic providers cannot serialize functions under Bun.
 * Existing deployments must reconcile unchanged records once to establish this dependency before changing families.
 */
export class DnsRecordSetLifecycle extends local.Command {
  constructor(name: string, generation: Input<string>, opts?: ResourceOptions) {
    super(name, { create: "true", triggers: [generation] }, { ...opts, deleteBeforeReplace: true })
  }
}

/**
 * Rejects CNAME sets that cannot coexist in DNS before registering provider resources.
 */
export function getDnsRecordFamily(types: string[]): DnsRecordFamily {
  const aliases = types.filter(type => type.toUpperCase() === "CNAME")
  if (aliases.length > 0 && types.length !== 1) {
    throw new Error("A CNAME record cannot coexist with other records in the same DNS record set")
  }

  return aliases.length > 0 ? "alias" : "records"
}
