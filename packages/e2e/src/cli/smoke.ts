import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startCli } from "../harness/cli"

const directory = await mkdtemp(join(tmpdir(), "highstate-cli-e2e-"))

try {
  await mkdir(join(directory, "home"))
  const help = startCli({ directory }, ["--help"])

  try {
    await help.end()
    await help.waitForOutput("highstate")
    const result = await help.result
    assert.equal(result.exitCode, 0, result.stderr)
    assert.match(result.stdout, /Usage|Commands|highstate/)
  } finally {
    await help.stop()
  }

  const invalid = startCli({ directory }, ["not-a-real-command"])

  try {
    await invalid.end()
    const result = await invalid.result
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stdout + result.stderr, /Unknown|not found|Unsupported/i)
  } finally {
    await invalid.stop()
  }

  const token = crypto.randomUUID()

  const add = startCli({ directory }, [
    "context",
    "add",
    "e2e",
    "--api-url",
    "http://127.0.0.1:1",
    "--api-token-stdin",
    "--insecure",
    "--output",
    "json",
  ])

  try {
    await add.write(`${token}\n`)
    await add.end()
    const result = await add.result
    assert.equal(result.exitCode, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).name, "e2e")
    assert.ok(!(result.stdout + result.stderr).includes(token))
  } finally {
    await add.stop()
  }

  const list = startCli({ directory }, ["context", "list", "--output", "json"])

  try {
    await list.end()
    const result = await list.result
    assert.equal(result.exitCode, 0, result.stderr)

    const { contexts } = JSON.parse(result.stdout) as {
      contexts: { name: string; has_token: boolean }[]
    }

    assert.ok(contexts.some(context => context.name === "e2e" && context.has_token))
    assert.ok(!(result.stdout + result.stderr).includes(token))
  } finally {
    await list.stop()
  }

  console.log(
    "PASS CLI execution, exit behavior, stdin token input, and isolated config persistence",
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
