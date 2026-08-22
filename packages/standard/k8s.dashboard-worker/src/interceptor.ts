import type { PanelHttpRequestInterceptor } from "@highstate/worker-sdk"

type DashboardConfig = {
  clusters: Array<{ name: string; useToken?: boolean }>
}

export function createDashboardInterceptor(): PanelHttpRequestInterceptor {
  let clusterPromise: Promise<string> | undefined

  return async (request, forward) => {
    clusterPromise ??= resolveDashboardCluster(request, forward)

    return await interceptDashboardRequest(request, forward, await clusterPromise)
  }
}

export async function resolveDashboardCluster(
  request: Request,
  forward: (request: Request) => Promise<Response>,
): Promise<string> {
  const response = await forward(
    new Request(new URL("/config", request.url), { headers: request.headers }),
  )
  if (!response.ok) {
    throw new Error(`Failed to load dashboard cluster configuration`)
  }

  const config = (await response.json()) as DashboardConfig
  if (config.clusters.length !== 1) {
    throw new Error(`Expected dashboard to expose exactly one cluster`)
  }

  return config.clusters[0]!.name
}

export async function interceptDashboardRequest(
  request: Request,
  forward: (request: Request) => Promise<Response>,
  cluster: string,
): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === "GET" && url.pathname === "/config") {
    return await disableDashboardTokenAuthentication(await forward(request))
  }
  if (request.method === "GET" && url.pathname === "/" && isNavigation(request)) {
    return Response.redirect(new URL(`/c/${encodeURIComponent(cluster)}/`, url), 302)
  }

  return await forward(request)
}

async function disableDashboardTokenAuthentication(response: Response): Promise<Response> {
  if (!response.ok) {
    return response
  }

  const config = (await response.json()) as DashboardConfig
  const headers = new Headers(response.headers)
  headers.delete("content-length")

  return new Response(
    JSON.stringify({
      ...config,
      clusters: config.clusters.map(cluster => ({ ...cluster, useToken: false })),
    }),
    {
      headers,
      status: response.status,
      statusText: response.statusText,
    },
  )
}

function isNavigation(request: Request): boolean {
  return request.headers.get("sec-fetch-mode") === "navigate"
}
