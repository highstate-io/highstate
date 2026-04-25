let hasResourceHooks = false

/**
 * Marks the current Pulumi program as using resource hooks.
 *
 * The backend uses `$hasResourceHooks` output to decide whether it should run the Pulumi program on destroy.
 */
export function setResourceHooks(): void {
  hasResourceHooks = true
}

export function getHasResourceHooks(): boolean {
  return hasResourceHooks
}
