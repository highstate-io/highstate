import { resolveCname } from "node:dns/promises"

export function normalizeDnsName(name: string): string {
  return name.toLowerCase().replace(/\.$/, "")
}

export function isDnsNameInZone(name: string, zone: string): boolean {
  const normalizedName = normalizeDnsName(name)
  const normalizedZone = normalizeDnsName(zone)
  return normalizedName === normalizedZone || normalizedName.endsWith(`.${normalizedZone}`)
}

/**
 * Validates existing ACME CNAME delegations and returns the names used to select a DNS issuer.
 * Each alias names the complete target TXT record, including any _acme-challenge prefix.
 */
export async function validateDnsChallengeAliases(
  names: string[],
  aliases: Record<string, string>,
  lookup: (name: string) => Promise<string[]> = resolveCname,
): Promise<string[]> {
  const normalizedNames = names.map(normalizeDnsName)
  const normalizedAliases = new Map<string, string>()

  for (const [name, target] of Object.entries(aliases)) {
    const normalizedName = normalizeDnsName(name)
    if (!normalizedNames.includes(normalizedName)) {
      throw new Error(`DNS challenge alias refers to unrequested certificate name "${name}"`)
    }

    const normalizedTarget = normalizeDnsName(target)
    if (!/^(?:[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?\.)+[a-z0-9-]+$/.test(normalizedTarget)) {
      throw new Error(`Invalid DNS challenge alias target "${target}"`)
    }

    const previous = normalizedAliases.get(normalizedName)
    if (previous && previous !== normalizedTarget) {
      throw new Error(`Conflicting DNS challenge aliases for "${name}"`)
    }

    normalizedAliases.set(normalizedName, normalizedTarget)
  }

  const verifiedRecords = new Map<string, string>()
  for (const [name, target] of normalizedAliases) {
    const record = `_acme-challenge.${name.replace(/^\*\./, "")}`
    if (record === target) {
      throw new Error(`DNS challenge alias "${record}" must point to a different record`)
    }

    const previous = verifiedRecords.get(record)
    if (previous && previous !== target) {
      throw new Error(`Conflicting DNS challenge aliases for "${record}"`)
    }

    if (previous) {
      continue
    }

    let actual: string[]
    try {
      actual = await lookup(record)
    } catch (error) {
      throw new Error(`Failed to resolve required CNAME "${record}" pointing to "${target}"`, {
        cause: error,
      })
    }

    if (actual.length !== 1 || normalizeDnsName(actual[0]) !== target) {
      throw new Error(`Expected CNAME "${record}" to point to "${target}"`)
    }

    verifiedRecords.set(record, target)
  }

  return normalizedNames.map(name => normalizedAliases.get(name) ?? name)
}
