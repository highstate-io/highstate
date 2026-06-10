import { getPort } from "get-port-please"

export const highstateConfigEndpointEnvVar = "HIGHSTATE_CONFIG_ENDPOINT"

export class LocalConfigServer {
  private constructor(
    readonly port: number,
    private readonly configMap: Map<string, string>,
    private readonly server: Bun.Server<undefined>,
  ) {}

  static async create(): Promise<LocalConfigServer> {
    const port = await getPort({ random: true })
    const configMap = new Map<string, string>()

    const server = Bun.serve({
      port,
      hostname: "localhost",
      fetch: request => {
        const pathname = new URL(request.url).pathname
        const configId = pathname.startsWith("/") ? pathname.slice(1) : pathname
        if (!configId) {
          return new Response("Not Found", { status: 404 })
        }

        const config = configMap.get(configId)
        if (!config) {
          return new Response("Not Found", { status: 404 })
        }

        return new Response(config, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
        })
      },
    })

    const instance = new LocalConfigServer(port, configMap, server)
    return instance
  }

  set(configId: string, config: unknown): string {
    this.configMap.set(configId, JSON.stringify(config))
    return `http://localhost:${this.port}/${configId}`
  }

  delete(configId: string): void {
    this.configMap.delete(configId)
  }

  stop(): void {
    this.server.stop(true)
    this.configMap.clear()
  }
}
