/** Runs every registered disposer, reporting cleanup failures alongside the scenario failure. */
export class Cleanup {
  private readonly disposers: (() => Promise<void>)[] = []

  add(dispose: () => Promise<void>): void {
    this.disposers.push(dispose)
  }

  async run(): Promise<void> {
    const errors: unknown[] = []
    for (const dispose of this.disposers.reverse()) {
      try {
        await dispose()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, "E2E cleanup failed")
  }
}
