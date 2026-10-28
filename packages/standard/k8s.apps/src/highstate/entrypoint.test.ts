import { afterEach, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function setup() {
  const path = await mkdtemp(join(tmpdir(), "highstate-entrypoint-test-"))
  directories.push(path)
  const bin = join(path, "bin")
  await mkdir(bin)
  const log = join(path, "calls")
  const admins = join(path, "admins.json")
  await writeFile(admins, JSON.stringify({ userIds: ["user-1"], groupIds: ["group-1"] }))

  const scripts = {
    docker: `#!/bin/sh
printf '%s\\n' "docker $*" >> "$CALL_LOG"
if [ "$1" = ps ]; then printf '%s' "\${STALE_CONTAINERS:-}"; fi
[ "\${DOCKER_FAIL:-false}" = false ]
`,
    sleep: `#!/bin/sh
printf '%s\\n' sleep >> "$CALL_LOG"
`,
    bun: `#!/bin/sh
if [ "$1" = -e ]; then exec "${process.execPath}" "$@"; fi
printf '%s\\n' "$PWD" "$HOME" "$PULUMI_HOME" "$HIGHSTATE_AUTH_PROVIDERS_FILE" "$HIGHSTATE_AUTH_ADMIN_USER_IDS" "$HIGHSTATE_AUTH_ADMIN_GROUP_IDS" "$*" >> "$CALL_LOG"
`,
  }

  for (const [name, content] of Object.entries(scripts)) {
    const file = join(bin, name)
    await writeFile(file, content)
    await chmod(file, 0o755)
  }

  const source = await readFile(
    new URL("../../../../../docker/highstate-entrypoint.sh", import.meta.url),
    "utf8",
  )

  const script = source
    .replaceAll("/data", `${path}/data`)
    .replaceAll("/run/user/0", `${path}/run`)
    .replaceAll("/opt/highstate", `${path}/image`)
    .replaceAll("/opt/pulumi", `${path}/pulumi`)

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    CALL_LOG: log,
    HIGHSTATE_AUTH_PROVIDERS_FILE: join(path, "providers.json"),
    HIGHSTATE_AUTH_INITIAL_ADMINS_PATH: admins,
  }

  return { path, log, admins, script, env }
}

describe("production entrypoint", () => {
  it("starts Nitro after Docker readiness with persistent paths and translated hosted auth configuration", async () => {
    const { path, log, script, env } = await setup()
    const result = spawnSync("sh", ["-c", script], { env, encoding: "utf8" })
    expect(result.status).toBe(0)

    expect((await readFile(log, "utf8")).trim().split("\n")).toEqual([
      "docker info",
      "docker ps --all --quiet",
      `${path}/data/workspace`,
      `${path}/data/home`,
      `${path}/data/pulumi`,
      `${path}/providers.json`,
      '["user-1"]',
      '["group-1"]',
      `${path}/image/packages/platform/designer/.output/server/index.mjs`,
    ])
  })

  it("fails without starting Nitro when Docker never becomes ready", async () => {
    const { log, script, env } = await setup()

    const result = spawnSync("sh", ["-c", script], {
      env: { ...env, DOCKER_FAIL: "true", HIGHSTATE_DOCKER_START_ATTEMPTS: "2" },
      encoding: "utf8",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Docker did not become ready")

    expect((await readFile(log, "utf8")).trim().split("\n")).toEqual([
      "docker info",
      "sleep",
      "docker info",
    ])
  })

  it("removes surviving containers from the dedicated daemon before starting Nitro", async () => {
    const { path, log, script, env } = await setup()

    const result = spawnSync("sh", ["-c", script], {
      env: { ...env, STALE_CONTAINERS: "worker-1\nterminal-1" },
      encoding: "utf8",
    })

    expect(result.status).toBe(0)
    const calls = (await readFile(log, "utf8")).trim().split("\n")

    expect(calls.slice(0, 4)).toEqual([
      "docker info",
      "docker ps --all --quiet",
      "docker rm --force worker-1 terminal-1",
      `${path}/data/workspace`,
    ])
  })

  it("creates a discoverable empty workspace and preserves its files on restart", async () => {
    const { path, script, env } = await setup()
    const workspace = join(path, "data/workspace")
    const run = () => spawnSync("sh", ["-c", script], { env, encoding: "utf8" })
    expect(run().status).toBe(0)

    expect(JSON.parse(await readFile(join(workspace, "bun.lock"), "utf8")).workspaces[""]).toEqual({
      name: "highstate-workspace",
    })

    const manifest = '{"name":"custom-workspace","private":true}'
    const lock = '{"lockfileVersion":1,"workspaces":{"":{"name":"custom-workspace"}}}'
    await writeFile(join(workspace, "package.json"), manifest)
    await writeFile(join(workspace, "bun.lock"), lock)
    expect(run().status).toBe(0)
    expect(await readFile(join(workspace, "package.json"), "utf8")).toBe(manifest)
    expect(await readFile(join(workspace, "bun.lock"), "utf8")).toBe(lock)
  })

  it("fails closed on a malformed admin document", async () => {
    const { admins, script, env, log } = await setup()
    await writeFile(admins, "{}")
    const result = spawnSync("sh", ["-c", script], { env, encoding: "utf8" })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Missing userIds")
    await expect(readFile(log, "utf8")).rejects.toThrow()
  })
})
