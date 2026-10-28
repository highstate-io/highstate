import { CustomResource, type dynamic, type Output } from "@pulumi/pulumi"

export type MarkerState = {
  endpoint: string
  key: string
  value: string
  marker: string
}

/**
 * Uses only local HTTP state, so lifecycle effects remain observable outside Pulumi.
 * The marker is stored in resource inputs and in the serialized provider implementation.
 */
export class MarkerProvider implements dynamic.ResourceProvider {
  constructor(private readonly implementation: string) {}

  private async request(method: string, state: MarkerState): Promise<Response> {
    const url = `${state.endpoint.replace(/\/$/, "")}/resources/${encodeURIComponent(state.key)}`
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json", "x-highstate-marker": this.implementation },
      body: method === "GET" ? undefined : JSON.stringify(state),
    })
    if (!response.ok && !(method === "GET" && response.status === 404)) {
      throw new Error(`Fixture HTTP ${method} failed with status ${response.status}`)
    }
    return response
  }

  async create(inputs: MarkerState): Promise<dynamic.CreateResult> {
    const outs = { ...inputs, marker: this.implementation }
    await this.request("POST", outs)
    return { id: inputs.key, outs }
  }

  async read(id: string, props: MarkerState): Promise<dynamic.ReadResult> {
    const response = await this.request("GET", props)
    if (response.status === 404) return { id: undefined, props }
    const remote = (await response.json()) as Partial<MarkerState>
    return { id, props: { ...props, ...remote } }
  }

  async diff(_id: string, olds: MarkerState, news: MarkerState): Promise<dynamic.DiffResult> {
    return {
      changes: olds.value !== news.value || olds.marker !== news.marker || olds.endpoint !== news.endpoint || olds.key !== news.key,
      replaces: ["endpoint", "key"].filter(key => olds[key as "endpoint" | "key"] !== news[key as "endpoint" | "key"]),
    }
  }

  async update(_id: string, _olds: MarkerState, news: MarkerState): Promise<dynamic.UpdateResult> {
    const outs = { ...news, marker: this.implementation }
    await this.request("PUT", outs)
    return { outs }
  }

  async delete(_id: string, props: MarkerState): Promise<void> {
    await this.request("DELETE", props)
  }
}

export class MarkerResource extends CustomResource {
  declare readonly marker: Output<string>
  declare readonly value: Output<string>

  constructor(name: string, args: Omit<MarkerState, "marker">, implementation: string) {
    // Pulumi's Bun host cannot serialize closures. The fixture build serializes
    // this provider with Node.js and packages the result in the immutable library.
    super("pulumi-nodejs:dynamic:Resource", name, { ...args, marker: implementation, __provider: "__SERIALIZED_PROVIDER__" })
  }
}
