import { l7EndpointToString } from "@highstate/common"
import type { influxdb3 } from "@highstate/library"

export type ApiRequestArgs = {
  connection: influxdb3.Connection
  method: string
  path: string
  body?: unknown
  queryParams?: Record<string, string>
}

export async function apiRequest<TResponse>(args: ApiRequestArgs): Promise<TResponse> {
  const url = new URL(args.path, getBaseUrl(args.connection))

  if (args.queryParams) {
    url.search = new URLSearchParams(args.queryParams).toString()
  }

  const response = await fetch(url, {
    method: args.method,
    headers: {
      Authorization: `Bearer ${args.connection.credentials.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
  })

  if (!response.ok) {
    const responseText = await response.text()

    throw new Error(`InfluxDB 3 request failed: ${responseText}`)
  }

  if (response.headers.get("content-type")?.includes("json")) {
    return await response.json()
  }

  return undefined!
}

function getBaseUrl(connection: influxdb3.Connection): string {
  const endpoint = connection.endpoints[0]
  if (!endpoint) {
    throw new Error("InfluxDB 3 connection has no endpoints.")
  }

  return l7EndpointToString(endpoint)
}
