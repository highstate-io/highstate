/**
 * Resolves a package's source root without assuming a fixed workspace nesting depth.
 */
export function sourceRoot(path: string): string | undefined {
  if (!path.startsWith("packages/") || !path.endsWith(".ts")) {
    return undefined
  }

  const index = path.indexOf("/src/")
  return index < 0 ? undefined : path.slice(0, index)
}
