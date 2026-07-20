import type { wireguard } from "@highstate/library"

type ConfigSection = {
  type: string
  comment?: string
  values: Map<string, string[]>
}

export type ParsedExistingConfigPeer = {
  name?: string
  publicKey: string
  presharedKey?: string
  allowedIps: string[]
  endpoint?: string
  persistentKeepalive: number
}

export type ParsedExistingConfig = {
  interface: {
    name?: string
    privateKey: string
    addresses: string[]
    dns: string[]
    listenPort: number
    amnezia: wireguard.AmneziaParameters
  }
  peers: ParsedExistingConfigPeer[]
}

const amneziaConfigKeys = [
  "i1",
  "i2",
  "i3",
  "i4",
  "i5",
  "s1",
  "s2",
  "s3",
  "s4",
  "jc",
  "jmin",
  "jmax",
  "h1",
  "h2",
  "h3",
  "h4",
] as const

const numericAmneziaConfigKeys = ["s1", "s2", "s3", "s4", "jc", "jmin", "jmax"] as const

type AmneziaConfigKey = (typeof amneziaConfigKeys)[number]
type NumericAmneziaConfigKey = (typeof numericAmneziaConfigKeys)[number]

const amneziaKeySet = new Set<string>(amneziaConfigKeys)
const numericAmneziaKeySet = new Set<string>(numericAmneziaConfigKeys)

function isNumericAmneziaConfigKey(key: string): key is NumericAmneziaConfigKey {
  return numericAmneziaKeySet.has(key)
}

function parseConfigSections(config: string): ConfigSection[] {
  const sections: ConfigSection[] = []
  let currentSection: ConfigSection | undefined
  let pendingComment: string | undefined

  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (!line) {
      continue
    }

    if (line.startsWith("#") || line.startsWith(";")) {
      const comment = line.slice(1).trim() || undefined
      if (currentSection && !currentSection.comment && currentSection.values.size === 0) {
        currentSection.comment = comment
      } else {
        pendingComment = comment
      }

      continue
    }

    const sectionMatch = line.match(/^\[([^\]]+)]$/)
    if (sectionMatch) {
      currentSection = {
        type: sectionMatch[1]?.trim().toLowerCase() ?? "",
        comment: pendingComment,
        values: new Map(),
      }
      sections.push(currentSection)
      pendingComment = undefined
      continue
    }

    if (!currentSection) {
      throw new Error(`WireGuard config contains key-value line outside of a section: ${rawLine}`)
    }

    const separatorIndex = line.indexOf("=")
    if (separatorIndex === -1) {
      throw new Error(`WireGuard config contains invalid line: ${rawLine}`)
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase()
    const value = line.slice(separatorIndex + 1).trim()
    currentSection.values.set(key, [...(currentSection.values.get(key) ?? []), value])
    pendingComment = undefined
  }

  return sections
}

function getValues(section: ConfigSection, key: string): string[] {
  return section.values.get(key.toLowerCase()) ?? []
}

function getRequiredValue(section: ConfigSection, key: string): string {
  const value = getValues(section, key).at(-1)

  if (!value) {
    throw new Error(`WireGuard [${section.type}] section is missing required "${key}" field.`)
  }

  return value
}

function getCommaSeparatedValues(section: ConfigSection, key: string): string[] {
  return getValues(section, key).flatMap(value =>
    value
      .split(",")
      .map(item => item.trim())
      .filter(Boolean),
  )
}

function parseOptionalNumber(section: ConfigSection, key: string, defaultValue: number): number {
  const value = getValues(section, key).at(-1)

  if (!value) {
    return defaultValue
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    throw new Error(`WireGuard [${section.type}] field "${key}" must be an integer.`)
  }

  return parsed
}

function parseAmneziaConfig(section: ConfigSection): wireguard.AmneziaParameters {
  const result: wireguard.AmneziaParameters = {}

  for (const [rawKey, values] of section.values) {
    const key = rawKey.toLowerCase()
    if (!amneziaKeySet.has(key)) {
      continue
    }

    const value = values.at(-1)
    if (!value) {
      continue
    }

    if (isNumericAmneziaConfigKey(key)) {
      const parsed = Number(value)
      if (!Number.isInteger(parsed)) {
        throw new Error(`AmneziaWG field "${rawKey}" must be an integer.`)
      }

      result[key] = parsed
    } else {
      result[key as Exclude<AmneziaConfigKey, NumericAmneziaConfigKey>] = value
    }
  }

  return result
}

export function parseExistingConfig(config: string): ParsedExistingConfig {
  const sections = parseConfigSections(config)
  const interfaceSection = sections.find(section => section.type === "interface")

  if (!interfaceSection) {
    throw new Error('WireGuard config must contain an "[Interface]" section.')
  }

  return {
    interface: {
      name: interfaceSection.comment,
      privateKey: getRequiredValue(interfaceSection, "PrivateKey"),
      addresses: getCommaSeparatedValues(interfaceSection, "Address"),
      dns: getCommaSeparatedValues(interfaceSection, "DNS"),
      listenPort: parseOptionalNumber(interfaceSection, "ListenPort", 51820),
      amnezia: parseAmneziaConfig(interfaceSection),
    },
    peers: sections
      .filter(section => section.type === "peer")
      .map(section => ({
        name: section.comment,
        publicKey: getRequiredValue(section, "PublicKey"),
        presharedKey: getValues(section, "PresharedKey").at(-1),
        allowedIps: getCommaSeparatedValues(section, "AllowedIPs"),
        endpoint: getValues(section, "Endpoint").at(-1),
        persistentKeepalive: parseOptionalNumber(section, "PersistentKeepalive", 0),
      })),
  }
}
