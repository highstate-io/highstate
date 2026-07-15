export type DnsNameMatcher = {
  type: "Exact" | "Suffix" | "RegularExpression"
  value: string
}

export function toDnsNameMatcher(pattern: string): DnsNameMatcher {
  if (!pattern.includes("*")) {
    return {
      type: "Exact",
      value: pattern,
    }
  }

  const labels = pattern.split(".")
  const suffixLabels = labels.slice(1)

  if (
    labels[0] === "**" &&
    suffixLabels.length > 0 &&
    suffixLabels.every(label => !label.includes("*"))
  ) {
    return {
      type: "Suffix",
      value: `.${suffixLabels.join(".")}`,
    }
  }

  return {
    type: "RegularExpression",
    value: patternToRegularExpression(pattern),
  }
}

function patternToRegularExpression(pattern: string): string {
  const parts = pattern.split(".").map(label => {
    if (label === "*") {
      return "[^.]+"
    }

    if (label === "**") {
      return "(?:[^.]+\\.)*[^.]+"
    }

    return escapeRegularExpression(label).replaceAll("\\*", "[^.]*")
  })

  return `^${parts.join("\\.")}$`
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.*]/g, "\\$&")
}
