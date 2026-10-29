import { z } from "@highstate/contract"
import { Worker } from "@highstate/worker-sdk"

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const bytes = new Uint8Array(await request.arrayBuffer())

    if (new URL(request.url).pathname.endsWith("/stream")) {
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("first-frame\n"))
            await Bun.sleep(1500)
            controller.enqueue(bytes)
            controller.close()
          },
        }),
        { headers: { "content-type": "application/octet-stream" } },
      )
    }

    return new Response(bytes, {
      headers: { "content-type": "application/octet-stream", "x-fixture-worker": "real-worker" },
    })
  },
})
const worker = await Worker.create({
  workerMeta: { title: "Fixture worker" },
  serviceAccountMeta: { title: "Fixture worker account" },
  paramsSchema: z.object({}),
})
worker.onUnitRegistration(async stateId => {
  await worker.setUnitPanels(stateId, [
    {
      name: "fixture",
      meta: { title: "Fixture panel" },
      target: `http://127.0.0.1:${server.port}`,
    },
  ])
})
await worker.start()
