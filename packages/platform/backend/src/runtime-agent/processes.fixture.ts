import { spawn } from "node:child_process"

type FixtureMessage = {
  ignoreInterrupt?: boolean
  ping?: boolean
  complete?: boolean
  interruptChild?: boolean
}

let interruptChild: (() => void) | undefined

process.on("message", (message: FixtureMessage) => {
  if (message.complete) {
    process.stdout.write("x".repeat(256 * 1024), () => process.exit(0))
    return
  }
  if (message.ping) {
    process.send?.({ pong: true })
    return
  }
  if (message.interruptChild) {
    interruptChild?.()
    return
  }
  const child = spawn(
    process.execPath,
    [
      "-e",
      `process.on('SIGINT',()=>{${message.ignoreInterrupt ? "" : "process.stdout.write('child-interrupted\\n');process.exit(0)"}});process.stdout.write('child-ready\\n');setInterval(()=>{},1000)`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  )
  child.stdout.pipe(process.stdout)
  child.stderr.pipe(process.stderr)
  interruptChild = () => child.kill("SIGINT")
  // the process group can deliver the child's exit before this process handles SIGINT
  const closed = new Promise<void>(resolve => {
    child.once("close", () => {
      process.send?.({ childExited: true })
      resolve()
    })
  })
  process.send?.({ started: true })
  process.on("SIGINT", () => {
    if (message.ignoreInterrupt) {
      process.send?.({ ignored: true })
      return
    }
    void closed.then(() => process.exit(0))
  })
})
