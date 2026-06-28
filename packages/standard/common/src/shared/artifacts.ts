export const artifactArchValues = ["amd64", "arm64"] as const

export type ArtifactArch = (typeof artifactArchValues)[number]

export type ArtifactParamValue = string | string[]

export type ArtifactParams = Record<string, ArtifactParamValue>

export type ArtifactMappings = Record<string, Record<string, string>>

export type ArtifactFile = {
  url: string
  sha256: Record<string, string>
  params?: ArtifactParams
  mappings?: ArtifactMappings
}

const urlParamPattern = /\{([^{}]+)\}/g

/**
 * Returns URL parameter names in first-occurrence order.
 *
 * @param url The URL template to inspect.
 * @returns The parameter names used by the URL template.
 */
export function getArtifactUrlParamOrder(url: string): string[] {
  const names: string[] = []

  for (const match of url.matchAll(urlParamPattern)) {
    const name = match[1]
    if (names.includes(name)) {
      continue
    }

    names.push(name)
  }

  return names
}

function replaceUrlParam(url: string, name: string, value: string): string {
  return url.replaceAll(`{${name}}`, value)
}

function mapParamValue(file: ArtifactFile, name: string, value: string): string {
  return file.mappings?.[name]?.[value] ?? value
}

function isParamMatch(keyParts: string[], index: number, values: string[]): boolean {
  const keyPart = keyParts[index]
  if (!keyPart) {
    return false
  }

  return values.includes(keyPart)
}

/**
 * Resolves an artifact file URL and filters hashes for the provided parameters.
 *
 * Scalar parameters are substituted into the URL.
 * Array parameters constrain matching hashes but keep the URL placeholder unresolved.
 * Mappings only affect URL substitution and never affect hash keys.
 *
 * @param file The artifact file definition.
 * @param params The extra parameters to merge with parameters from the artifact definition.
 * @returns The artifact file with resolved URL/hash data and no parameter metadata.
 */
export function resolveArtifactFile(file: ArtifactFile, params: ArtifactParams = {}): ArtifactFile {
  const mergedParams = {
    ...(file.params ?? {}),
    ...params,
  }

  const paramOrder = getArtifactUrlParamOrder(file.url)
  const constraints = new Map<string, string[]>()
  let url = file.url

  for (const name of paramOrder) {
    const value = mergedParams[name]
    if (!value) {
      continue
    }

    if (Array.isArray(value)) {
      constraints.set(name, value)
      continue
    }

    constraints.set(name, [value])
    url = replaceUrlParam(url, name, mapParamValue(file, name, value))
  }

  const sha256 = Object.fromEntries(
    Object.entries(file.sha256).filter(([key]) => {
      const keyParts = key.split("-")

      for (const [name, values] of constraints) {
        const index = paramOrder.indexOf(name)
        if (index === -1) {
          continue
        }

        if (!isParamMatch(keyParts, index, values)) {
          return false
        }
      }

      return true
    }),
  )

  return {
    url,
    sha256,
  }
}
