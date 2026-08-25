import type { StoredPlan } from "./shared"
import { createHash } from "node:crypto"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { createHighstateMcpServer } from "./server"

export type HighstateMcpHandlerOptions = {
  apiUrl: string
  apiToken?: string
}

export function createPlanStore(now = () => Date.now()) {
  const stores = new Map<string, { plans: Map<string, StoredPlan>; expiresAt: number }>()
  const ttl = 15 * 60 * 1000
  const maxStores = 1_000

  return {
    getPlans(apiToken: string): Map<string, StoredPlan> {
      const currentTime = now()
      for (const [tokenHash, state] of stores) {
        if (state.expiresAt <= currentTime) {
          stores.delete(tokenHash)
        }
      }

      const tokenHash = createHash("sha256").update(apiToken).digest("hex")
      let state = stores.get(tokenHash)
      if (!state) {
        if (stores.size >= maxStores) {
          const oldestTokenHash = stores.keys().next().value
          if (oldestTokenHash) {
            stores.delete(oldestTokenHash)
          }
        }
        state = { plans: new Map<string, StoredPlan>(), expiresAt: currentTime + ttl }
        stores.set(tokenHash, state)
      } else {
        state.expiresAt = currentTime + ttl
      }

      return state.plans
    },
  }
}

export function createHighstateMcpHandler(options: HighstateMcpHandlerOptions) {
  const planStore = createPlanStore()

  return async function handleHighstateMcpRequest(request: Request): Promise<Response> {
    const authorization = request.headers.get("authorization")
    const apiToken = authorization === null ? options.apiToken : getApiToken(request)

    if (!apiToken) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Highstate API key required in the Authorization header",
          },
          id: null,
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      )
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    const mcp = createHighstateMcpServer(options.apiUrl, { apiToken }, planStore.getPlans(apiToken))
    await mcp.server.connect(transport)

    try {
      return await transport.handleRequest(request)
    } finally {
      await mcp.close()
    }
  }
}

function getApiToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization")
  const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? "")
  if (!match) {
    return undefined
  }

  return match[1]
}

export type { HighstateCredentials } from "./client"
export { createHighstateMcpServer } from "./server"
