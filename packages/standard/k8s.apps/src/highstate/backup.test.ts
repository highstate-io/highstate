import { afterEach, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { coordinateBackupScript, offlineBackupScript } from "./scripts"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), "highstate-backup-test-"))
  directories.push(path)
  const log = join(path, "calls")
  const kubectl = join(path, "kubectl")

  await writeFile(
    kubectl,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$*" in
  *"create configmap"*) [ "\${FAIL_AT:-}" != lock ] ;;
  *"get deployment"*) [ "\${FAIL_AT:-}" != preflight ] || exit 1; printf '%s' "\${REPLICAS:-1}" ;;
  *"rollout status"*) [ "\${FAIL_AT:-}" != shutdown ] ;;
  *"wait --for=condition=complete"*) [ "\${FAIL_AT:-}" != backup ] ;;
  *"get pods"*)
    [ "\${FAIL_AT:-}" != pods ] || exit 1
    if [ "\${DELAY_PODS:-false}" = true ]; then
      case "$*" in *"app.kubernetes"*) marker=runtime ;; *) marker=backup ;; esac
      if [ ! -f "$CALL_LOG.$marker" ]; then
        touch "$CALL_LOG.$marker"
        printf '%s' pod/terminating
      fi
    else
      printf '%s' "\${ACTIVE_PODS:-}"
    fi ;;
esac
`,
  )

  await chmod(kubectl, 0o755)
  await writeFile(join(path, "sleep"), '#!/bin/sh\nprintf "%s\\n" sleep >> "$CALL_LOG"\n')
  await chmod(join(path, "sleep"), 0o755)
  return {
    path,
    log,
    env: {
      ...process.env,
      PATH: `${path}:${process.env.PATH}`,
      CALL_LOG: log,
      NAMESPACE: "test",
      DEPLOYMENT: "highstate",
      BACKUP_TEMPLATE: "offline",
    },
  }
}

describe("coordinated offline backup", () => {
  it("stops all runtime pods before creating the job and waits for unmount before resuming", async () => {
    const { env, log } = await fixture()
    const result = spawnSync("sh", ["-c", coordinateBackupScript], { env, encoding: "utf8" })
    expect(result.status).toBe(0)
    const calls = (await readFile(log, "utf8")).trim().split("\n")

    expect(calls.map(call => call.replace(/highstate-backup-\d+/g, "JOB"))).toEqual([
      "-n test create configmap highstate-backup-lock --from-literal=job=JOB",
      "-n test get deployment highstate -o jsonpath={.spec.replicas}",
      "-n test scale deployment highstate --current-replicas=1 --replicas=0",
      "-n test rollout status deployment/highstate --timeout=600s",
      "-n test get pods -l app.kubernetes.io/name=highstate -o name",
      "-n test create job JOB --from=cronjob/offline",
      "-n test wait --for=condition=complete job/JOB --timeout=3600s",
      "-n test logs job/JOB",
      "-n test delete job JOB --wait=true",
      "-n test get pods -l job-name=JOB -o name",
      "-n test scale deployment highstate --current-replicas=0 --replicas=1",
      "-n test rollout status deployment/highstate --timeout=600s",
      "-n test delete configmap highstate-backup-lock",
    ])
  })

  for (const failure of ["lock", "shutdown", "pods", "backup"]) {
    it(`does not resume or remove the maintenance lock after ${failure} failure`, async () => {
      const { env, log } = await fixture()

      const result = spawnSync("sh", ["-c", coordinateBackupScript], {
        env: { ...env, FAIL_AT: failure },
      })

      expect(result.status).not.toBe(0)
      const calls = await readFile(log, "utf8")
      expect(calls).not.toContain("--replicas=1")
      expect(calls).not.toContain("delete configmap")

      if (failure !== "backup") {
        expect(calls).not.toContain("create job")
      }
    })
  }

  it("releases its own lock after a preflight failure without changing replicas", async () => {
    const { env, log } = await fixture()

    const result = spawnSync("sh", ["-c", coordinateBackupScript], {
      env: { ...env, FAIL_AT: "preflight" },
    })

    expect(result.status).not.toBe(0)
    const calls = await readFile(log, "utf8")
    expect(calls).toContain("delete configmap highstate-backup-lock")
    expect(calls).not.toContain("scale deployment")
    expect(calls).not.toContain("create job")
  })

  it("waits through terminating runtime and backup pods before handing off the exclusive PVC", async () => {
    const { env, log } = await fixture()

    const result = spawnSync("sh", ["-c", coordinateBackupScript], {
      env: { ...env, DELAY_PODS: "true" },
    })

    expect(result.status).toBe(0)
    const calls = (await readFile(log, "utf8")).trim().split("\n")
    const creation = calls.findIndex(call => call.includes("create job"))
    const resume = calls.findIndex(call => call.includes("--replicas=1"))
    expect(calls.slice(0, creation).filter(call => call.includes("get pods"))).toHaveLength(2)
    expect(calls.slice(creation, resume).filter(call => call.includes("get pods"))).toHaveLength(2)
    expect(calls.filter(call => call === "sleep")).toHaveLength(2)
  })

  it("keeps the runtime stopped for before-destroy backup", async () => {
    const { env, log } = await fixture()

    const result = spawnSync("sh", ["-c", coordinateBackupScript], {
      env: { ...env, RESUME: "false" },
    })

    expect(result.status).toBe(0)
    expect(await readFile(log, "utf8")).not.toContain("--replicas=1")
  })

  it("refuses a filesystem capture while a runtime pod still exists", async () => {
    const { env, log } = await fixture()

    const result = spawnSync("sh", ["-c", offlineBackupScript], {
      env: { ...env, REPLICAS: "0", ACTIVE_PODS: "pod/stopping" },
    })

    expect(result.status).not.toBe(0)
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(3)
  })

  it("fails closed if pod listing fails during the offline safety check", async () => {
    const { env } = await fixture()

    const result = spawnSync("sh", ["-c", offlineBackupScript], {
      env: { ...env, REPLICAS: "0", FAIL_AT: "pods" },
      encoding: "utf8",
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).not.toContain("restic")
  })

  it.each([
    "",
    "repository",
    "dump",
    "upload",
  ])("captures a complete recovery set or fails on %s", async failure => {
    const { path, env } = await fixture()
    const data = join(path, "data")
    const recovery = join(path, "recovery")
    await mkdir(data)
    await mkdir(recovery)

    for (const file of [
      "project.db",
      "project.db-wal",
      "artifact.enc",
      "model.yaml",
      "pulumi-state",
      "key-envelope",
    ]) {
      await writeFile(join(data, file), file)
    }

    await writeFile(join(recovery, "backend-identity"), "recovery-key")

    await writeFile(
      join(path, "pg_dump"),
      `#!/bin/sh
printf '%s\\n' pg_dump >> "$CALL_LOG"
[ "\${FAIL_AT:-}" != dump ] || exit 1
for arg do case "$arg" in --file=*) printf '%s' 'database-dump' > "\${arg#--file=}" ;; esac; done
`,
    )

    await writeFile(
      join(path, "restic"),
      `#!/bin/sh
printf '%s\\n' "restic $*" >> "$CALL_LOG"
if [ "$1" = snapshots ]; then [ "\${FAIL_AT:-}" != repository ] || exit 1; fi
if [ "$1" = backup ]; then
  [ "\${FAIL_AT:-}" != upload ] || exit 1
  test -f "$TEST_ROOT/backup/backend.pgdump"
  test -f "$TEST_ROOT/backup/recovery/backend-identity"
  test -f "$TEST_ROOT/backup/manifest.json"
  test "$6" = "$TEST_ROOT/data"
  test "$7" = "$TEST_ROOT/backup"
fi
`,
    )

    await chmod(join(path, "pg_dump"), 0o755)
    await chmod(join(path, "restic"), 0o755)

    const script = offlineBackupScript.replace(
      /(^|[\s"=])\/(backup|recovery|data)/g,
      (_, prefix: string, directory: string) => `${prefix}${join(path, directory)}`,
    )

    const result = spawnSync("sh", ["-c", script], {
      env: {
        ...env,
        REPLICAS: "0",
        TEST_ROOT: path,
        HIGHSTATE_BACKEND_DATABASE_POSTGRESQL_URL: "postgresql://test",
        HIGHSTATE_BACKUP_MANIFEST: '{"format":"test"}',
        FAIL_AT: failure,
      },
      encoding: "utf8",
    })

    expect(result.status).toBe(failure ? 1 : 0)
    const calls = await readFile(env.CALL_LOG, "utf8")

    if (failure === "repository") {
      expect(calls).not.toContain("pg_dump")
      expect(calls).not.toContain("restic backup")
      return
    }

    if (failure === "dump") {
      expect(calls).not.toContain("restic backup")
      return
    }

    expect(await readFile(join(path, "backup/recovery/backend-identity"), "utf8")).toBe(
      "recovery-key",
    )

    expect(await readFile(join(data, "project.db-wal"), "utf8")).toBe("project.db-wal")
  })
})
