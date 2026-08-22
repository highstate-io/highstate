import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "@highstate/contract"
import { Worker } from "@highstate/worker-sdk"
import { createDashboardInterceptor } from "./interceptor"

type DashboardInstance = {
  process: Bun.Subprocess
  root: string
}

const worker = await Worker.create({
  workerMeta: {
    title: "Kubernetes Dashboard Worker",
    description: "Serves an isolated dashboard for each Kubernetes cluster.",
    icon: "devicon:kubernetes",
  },
  serviceAccountMeta: {
    title: "Kubernetes Dashboard Agent",
    description: "Service account for Kubernetes dashboards.",
    icon: "devicon:kubernetes",
  },
  paramsSchema: z.object({
    kubeconfig: z.string().min(1),
  }),
})

const instances = new Map<string, DashboardInstance>()

worker.onUnitRegistration(async (stateId, params) => {
  await stopInstance(stateId)

  const root = join("/tmp/highstate-dashboard", stateId)
  const kubeconfigPath = join(root, "kubeconfig")
  await mkdir(root, { recursive: true, mode: 0o700 })
  await writeFile(kubeconfigPath, params.kubeconfig, { mode: 0o600 })

  const port = await getAvailablePort()
  const process = Bun.spawn(
    [
      "/headlamp/headlamp-server",
      "-html-static-dir",
      "/headlamp/frontend",
      "-plugins-dir",
      "/headlamp/plugins",
      "-kubeconfig",
      kubeconfigPath,
      "-listen-addr",
      "127.0.0.1",
      "-port",
      String(port),
      "-watch-plugins-changes=false",
    ],
    {
      env: { ...Bun.env, HOME: root },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  )

  try {
    instances.set(stateId, { process, root })
    await worker.setUnitPanels(stateId, [
      {
        name: "dashboard",
        meta: {
          title: "Dashboard",
          description: "Manage and inspect this Kubernetes cluster.",
          icon: "devicon:kubernetes",
        },
        interceptHttpRequest: createDashboardInterceptor(),
        target: `http://127.0.0.1:${port}`,
      },
    ])
  } catch (error) {
    await stopInstance(stateId)
    throw error
  }
})

worker.onUnitDeregistration(async stateId => {
  try {
    await worker.setUnitPanels(stateId, [])
  } finally {
    await stopInstance(stateId)
  }
})

await worker.start()

async function stopInstance(stateId: string): Promise<void> {
  const instance = instances.get(stateId)
  if (!instance) {
    return
  }

  instances.delete(stateId)
  instance.process.kill("SIGTERM")
  await rm(instance.root, { recursive: true, force: true })
}

async function getAvailablePort(): Promise<number> {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(null, { status: 503 }),
  })
  const port = server.port
  await server.stop(true)

  if (port === undefined) {
    throw new Error("Failed to allocate a loopback port")
  }

  return port
}
