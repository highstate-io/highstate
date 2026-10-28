import type { RuntimeSession } from "@highstate/backend"

/** Collects session output immediately so short-lived execs cannot lose their output. */
export function observeSession(session: RuntimeSession) {
  let output = ""
  let failure: Error | undefined
  session.stream.on("data", chunk => {
    output += Buffer.from(chunk).toString()
  })
  session.stream.on("error", error => {
    failure = error
  })
  return {
    output: () => output,
    async waitFor(fragment: string, timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs
      while (!output.includes(fragment)) {
        if (failure) throw failure
        if (Date.now() > deadline)
          throw new Error(
            `Session did not produce ${JSON.stringify(fragment)}; received ${JSON.stringify(output)}`,
          )
        await Bun.sleep(25)
      }
      return output
    },
  }
}
