import { describe, expect, test, vi } from "vitest"
import { interceptDashboardRequest, resolveDashboardCluster } from "./interceptor"

describe("dashboard interceptor", () => {
  test("resolves the only configured cluster", async () => {
    const forward = vi.fn(async (_request: Request) =>
      Response.json({ clusters: [{ auth_type: "", name: "cluster name" }] }),
    )
    const cluster = await resolveDashboardCluster(new Request("http://panel.local/"), forward)

    expect(cluster).toBe("cluster name")
    expect(new URL(forward.mock.calls[0]![0]!.url).pathname).toBe("/config")
  })

  test("rejects configurations without exactly one cluster", async () => {
    await expect(
      resolveDashboardCluster(new Request("http://panel.local/"), async () =>
        Response.json({ clusters: [] }),
      ),
    ).rejects.toThrow("Expected dashboard to expose exactly one cluster")
  })

  test("redirects landing navigations to the cluster dashboard", async () => {
    const forward = vi.fn()
    const response = await interceptDashboardRequest(
      new Request("http://panel.local/", {
        headers: { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" },
      }),
      forward,
      "cluster name",
    )

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("http://panel.local/c/cluster%20name/")
    expect(forward).not.toHaveBeenCalled()
  })

  test("disables browser token authentication in dashboard configuration", async () => {
    const request = new Request("http://panel.local/config", {
      headers: { authorization: "Bearer browser-token", cookie: "browser=value" },
    })
    const forward = vi.fn(async (forwardedRequest: Request) => {
      expect(forwardedRequest).toBe(request)

      return Response.json({
        allowKubeconfigChanges: false,
        clusters: [{ auth_type: "", name: "cluster", server: "https://cluster.example" }],
      })
    })
    const response = await interceptDashboardRequest(request, forward, "cluster")

    expect(await response.json()).toEqual({
      allowKubeconfigChanges: false,
      clusters: [
        {
          auth_type: "",
          name: "cluster",
          server: "https://cluster.example",
          useToken: false,
        },
      ],
    })
    expect(forward).toHaveBeenCalledOnce()
  })

  test("passes other requests through without buffering", async () => {
    const upstream = new Response("event data", {
      headers: { "content-type": "text/event-stream" },
    })
    const response = await interceptDashboardRequest(
      new Request("http://panel.local/clusters/cluster/api/v1/pods"),
      async () => upstream,
      "cluster",
    )

    expect(response).toBe(upstream)
  })
})
