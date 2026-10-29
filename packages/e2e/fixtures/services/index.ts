import { createHash } from "node:crypto"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HighstateSignature } from "@highstate/contract"
import { forUnit, getHighstateRuntime, makeEntityOutput } from "@highstate/pulumi"
import { fileEntity, services } from "../library"
import { MarkerResource } from "../provider"

const { name, args, outputs } = forUnit(services)
const sidecar = await getHighstateRuntime().sidecar.start({
  dnsName: "fixture.internal",
  image: "mirror.gcr.io/library/busybox:1.37",
  command: ["sh", "-ec"],
  args: ["exec httpd -f -p 8080 -h /www"],
  env: {},
  files: [{ path: "/www/index.html", content: "sidecar-file-content", secret: false, mode: 0o644 }],
  ports: [{ name: "http", containerPort: 8080, protocol: "tcp" }],
  readiness: { type: "http", port: "http", path: "/", statuses: [200], timeoutSeconds: 20 },
})
const response = await fetch(`http://${sidecar.host}:${sidecar.ports.http!.port}/`)
if (!response.ok || (await response.text()) !== "sidecar-file-content") {
  throw new Error("Sidecar DNS, readiness, or file transfer failed")
}
new MarkerResource(
  name,
  { endpoint: args.endpoint, key: "services", value: "sidecar-file-content" },
  "services",
)

const directory = await mkdtemp(join(tmpdir(), "e2e-artifact-"))
await writeFile(join(directory, "payload.txt"), "durable-artifact-content\n")
const archive = join(directory, "payload.tgz")
const tar = Bun.spawn(
  ["tar", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "-czf", archive, "payload.txt"],
  { cwd: directory },
)
if (await tar.exited) {
  throw new Error("Fixture artifact archive failed")
}
const bytes = await readFile(archive)
const hash = createHash("sha256").update(bytes).digest("hex")
await writeFile(join(process.env.HIGHSTATE_ARTIFACT_WRITE_PATH!, `${hash}.tgz`), bytes)
const file = {
  meta: { name: "payload.tgz", size: bytes.length, contentType: "application/gzip", mode: 0o600 },
  content: { type: "artifact" as const, [HighstateSignature.Artifact]: true as const, hash },
}
export default outputs({
  file: makeEntityOutput({ entity: fileEntity, identity: "payload", value: file }),
  $terminals: {
    fixture: {
      meta: { title: "Fixture terminal" },
      spec: {
        image: "mirror.gcr.io/library/busybox:1.37",
        command: ["sh"],
        files: { "/tmp/payload.tgz": file },
      },
    },
  },
  $workers: { fixture: { image: args.workerImage, params: {} } },
})
