const knownAbbreviationsMap = new Map<string, string>()

export function registerKnownAbbreviations(abbreviations: string[]) {
  for (const abbr of abbreviations) {
    const lower = abbr.toLowerCase()
    if (!knownAbbreviationsMap.has(lower)) {
      knownAbbreviationsMap.set(lower, abbr)
    }
  }
}

export function clearKnownAbbreviations() {
  knownAbbreviationsMap.clear()
}

export function camelCaseToHumanReadable(text: string) {
  // split on: word boundaries between consecutive uppercase and lowercase letters,
  // single uppercase letters followed by lowercase, and separators
  const words = text
    .split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|_|-|\./)
    .filter(word => word.length > 0)

  return words
    .map(word => {
      const lower = word.toLowerCase()
      if (knownAbbreviationsMap.has(lower)) {
        return knownAbbreviationsMap.get(lower)
      }

      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(" ")
}
