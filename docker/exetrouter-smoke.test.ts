import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, test } from "vitest"
import { backupExcludes, onlineBackupScript, postRestoreScript } from "../packages/standard/k8s.apps/src/exetrouter/backup"

const image = "highstate-exetrouter:smoke"
const prefix = `highstate-exetrouter-${randomUUID()}`
const volumes = ["state", "runtime", "config", "restored", "repo"].map(name => `${prefix}-${name}`)
const [state, runtime, config, restored, repo] = volumes
const api = `${prefix}-api`
const ssh = `${prefix}-ssh`

function docker(args: string[], input?: string): string {
  return execFileSync("docker", args, { encoding: "utf8", input, timeout: 120_000 }).trim()
}

const configMount = ["-v", `${config}:/etc/exetrouter:ro`]
const runtimeMount = ["-v", `${runtime}:/run/exetrouter`]

beforeAll(() => {
  execFileSync("docker", ["build", "-t", image, "-f", "docker/exetrouter.dockerfile", "docker"], {
    stdio: "inherit", timeout: 300_000,
  })
  for (const volume of volumes) {
    docker(["volume", "create", volume])
  }

  docker(["run", "--rm", "-i", "-v", `${config}:/etc/exetrouter`, "--entrypoint", "sh", image,
    "-c", "cat > /etc/exetrouter/config.json"], JSON.stringify({
      db: "/state/private/exetrouter.sqlite",
      key: "/state/private/exetrouter.key",
      oauth_key: "/state/private/exetrouter.oauth.key",
      control_socket: "/run/exetrouter/control.sock",
      gateway_uid: 10003,
      listen: "0.0.0.0:8787",
    }))
  docker(["run", "--rm", ...configMount, ...runtimeMount, "-v", `${state}:/state`, image, "prepare"])
  docker(["run", "-d", "--name", api, "--user", "10001:10002", "--read-only", "--tmpfs", "/tmp",
    ...configMount, ...runtimeMount, "--mount", `type=volume,source=${state},target=/state/private,volume-subpath=private`, image, "api"])
  docker(["run", "-d", "--name", ssh, "--network", `container:${api}`, ...configMount, ...runtimeMount,
    "--mount", `type=volume,source=${state},target=/ssh,volume-subpath=ssh,readonly`, image, "ssh"])
}, 360_000)

afterAll(() => {
  for (const name of [ssh, api]) {
    try { docker(["rm", "-f", name]) } catch { /* already removed */ }
  }
  for (const volume of volumes) {
    try { docker(["volume", "rm", volume]) } catch { /* setup may have failed */ }
  }
})

test("serves the API, isolates SSH management, and restores a consistent encrypted backup", async () => {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      docker(["exec", api, "curl", "-fsS", "http://127.0.0.1:8787/healthz"])
      break
    } catch {
      if (attempt === 29) { throw new Error(docker(["logs", api])) }
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  expect(docker(["exec", api, "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
    "http://127.0.0.1:8787/v1/models"])).toBe("401")
  expect(docker(["exec", ssh, "sh", "-c", "test ! -e /state/private/exetrouter.sqlite && echo isolated"])).toBe("isolated")
  expect(docker(["exec", ssh, "runuser", "-u", "routercli", "--", "sh", "-c",
    "test ! -r /ssh/ssh_host_ed25519_key && echo private"])).toBe("private")

  const owner = JSON.parse(docker(["exec", api, "exrd", "--json", "admin", "user-create", "owner"]))
  docker(["exec", ssh, "ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", "/tmp/test-key"])
  const publicKey = docker(["exec", ssh, "cat", "/tmp/test-key.pub"])
  docker(["exec", "-i", api, "sh", "-c", "cat > /tmp/owner.pub"], publicKey)
  docker(["exec", api, "exrd", "admin", "ssh-key-add", "--user-id", String(owner.id), "--public-key-file", "/tmp/owner.pub"])
  await new Promise(resolve => setTimeout(resolve, 5500))

  const sshCommand = ["exec", "-i", ssh, "ssh", "-i", "/tmp/test-key", "-p", "2222",
    "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
    "routercli@127.0.0.1"]
  const reply = JSON.parse(docker([...sshCommand, "exrd-gateway"], '{"action":"token_list"}'))
  expect(reply).toMatchObject({ ok: true, result: [] })
  expect(() => docker([...sshCommand, "sh"], "id")).toThrow()

  const hostKey = docker(["exec", ssh, "ssh-keygen", "-lf", "/ssh/ssh_host_ed25519_key.pub"])
  const keyHashes = docker(["exec", api, "sha256sum", "/state/private/exetrouter.key", "/state/private/exetrouter.oauth.key"])

  // exercise the unit's actual online backup and post-restore hooks against a live WAL database
  docker(["run", "--rm", "-i", "-v", `${state}:/data`, "-v", `${repo}:/repo`, "--entrypoint", "sh", image, "-s"], `
set -eu
apt-get update -qq && apt-get install -y -qq sqlite3 restic >/dev/null
${onlineBackupScript}
export RESTIC_REPOSITORY=/repo RESTIC_PASSWORD=smoke-only
restic init >/dev/null
restic backup /data ${backupExcludes.map(path => `--exclude=${path}`).join(" ")} >/dev/null
`)
  docker(["run", "--rm", "-i", "-v", `${restored}:/data`, "-v", `${repo}:/repo`, "--entrypoint", "sh", image, "-s"], `
set -eu
apt-get update -qq && apt-get install -y -qq restic >/dev/null
export RESTIC_REPOSITORY=/repo RESTIC_PASSWORD=smoke-only
restic restore latest --target / >/dev/null
${postRestoreScript}
`)
  docker(["run", "--rm", ...configMount, ...runtimeMount, "-v", `${restored}:/state`, image, "prepare"])
  const restoredUsers = JSON.parse(docker(["run", "--rm", "--user", "10001:10002", ...configMount,
    "-v", `${restored}:/state`, image, "exrd", "--json", "admin", "user-list"]))
  expect(restoredUsers).toEqual([expect.objectContaining({ id: owner.id, name: "owner" })])
  expect(docker(["run", "--rm", "-v", `${restored}:/state`, image, "sha256sum",
    "/state/private/exetrouter.key", "/state/private/exetrouter.oauth.key"])).toBe(keyHashes)
  expect(docker(["run", "--rm", "-v", `${restored}:/state`, image, "ssh-keygen", "-lf",
    "/state/ssh/ssh_host_ed25519_key.pub"])).toBe(hostKey)
}, 240_000)
