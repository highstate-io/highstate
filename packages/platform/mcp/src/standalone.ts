import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createHighstateMcpHandler, createHighstateMcpServer } from "./index"

const apiUrl = process.env.HIGHSTATE_API_URL

if (!apiUrl) {
  throw new Error("HIGHSTATE_API_URL is required")
}

const portValue = process.env.HIGHSTATE_MCP_PORT
if (portValue !== undefined) {
  const hostname = process.env.HIGHSTATE_MCP_HOST ?? "127.0.0.1"
  const port = Number(portValue)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("HIGHSTATE_MCP_PORT must be an integer between 1 and 65535")
  }

  const handler = createHighstateMcpHandler({
    apiUrl,
    apiToken: process.env.HIGHSTATE_API_TOKEN,
  })

  Bun.serve({
    hostname,
    port,
    routes: {
      "/mcp": request => handler(request),
    },
  })

  console.info(`highstate mcp server listening at "http://${hostname}:${port}/mcp"`)
} else {
  const apiToken = process.env.HIGHSTATE_API_TOKEN
  if (!apiToken) {
    throw new Error("HIGHSTATE_API_TOKEN is required in stdio mode")
  }

  const mcp = createHighstateMcpServer(apiUrl, { apiToken })
  await mcp.server.connect(new StdioServerTransport())
}
