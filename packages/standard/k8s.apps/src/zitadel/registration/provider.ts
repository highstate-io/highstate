import type {
  CreateResult,
  DiffResult,
  ReadResult,
  ResourceProvider,
  UpdateResult,
} from "@pulumi/pulumi/dynamic"

export type ApplicationInputs = {
  issuer: string
  token: string
  organizationId: string
  projectId: string
  name: string
  redirectUris: string[]
}

export type ApplicationState = ApplicationInputs & {
  clientId: string
  clientSecret: string
  configurationDrift: boolean
}

type OidcConfig = {
  clientId: string
  redirectUris?: string[]
  authMethodType?: string
  responseTypes?: string[]
  grantTypes?: string[]
  appType?: string
  version?: string
  idTokenUserinfoAssertion?: boolean
}

/** Builds an HTTPS callback without allowing the path to change its origin. */
export function applicationCallback(fqdn: string, path: string): string {
  const origin = new URL(`https://${fqdn}`)
  const callback = new URL(path, origin)
  if (
    callback.origin !== origin.origin ||
    callback.hash ||
    callback.username ||
    callback.password
  ) {
    throw new Error("Callback must be a same-origin path without a fragment")
  }
  return callback.href
}

// Management v1 remains supported by the pinned ZITADEL v4 release.
// https://github.com/zitadel/zitadel/blob/v4.19.2/proto/zitadel/management.proto
export class ApplicationProvider implements ResourceProvider<ApplicationInputs, ApplicationState> {
  private config(inputs: ApplicationInputs) {
    return {
      redirectUris: inputs.redirectUris,
      responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
      grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"],
      appType: "OIDC_APP_TYPE_WEB",
      authMethodType: "OIDC_AUTH_METHOD_TYPE_BASIC",
      version: "OIDC_VERSION_1_0",
      // generic OIDC consumers obtain profile attributes from the verified ID token
      idTokenUserinfoAssertion: true,
    }
  }

  private path(inputs: ApplicationInputs, id?: string) {
    return `/management/v1/projects/${encodeURIComponent(inputs.projectId)}/apps${id ? `/${encodeURIComponent(id)}` : ""}`
  }

  private async request<T>(
    inputs: ApplicationInputs,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T | undefined> {
    const response = await fetch(`${inputs.issuer.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${inputs.token}`,
        "Content-Type": "application/json",
        "x-zitadel-orgid": inputs.organizationId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    })
    if (response.status === 404 && (method === "GET" || method === "DELETE")) {
      return undefined
    }
    if (!response.ok) {
      // API bodies may contain credentials; never put them into Pulumi diagnostics
      throw new Error(`Zitadel ${method} request failed with HTTP ${response.status}`)
    }
    return (await response.json()) as T
  }

  async create(inputs: ApplicationInputs): Promise<CreateResult<ApplicationState>> {
    const result = await this.request<{ appId: string; clientId: string; clientSecret: string }>(
      inputs,
      "POST",
      `${this.path(inputs)}/oidc`,
      { name: inputs.name, ...this.config(inputs) },
    )
    if (!result?.appId || !result.clientId || !result.clientSecret) {
      throw new Error("Zitadel did not return application credentials")
    }
    return {
      id: result.appId,
      outs: {
        ...inputs,
        clientId: result.clientId,
        clientSecret: result.clientSecret,
        configurationDrift: false,
      },
    }
  }

  async diff(_id: string, olds: ApplicationState, news: ApplicationInputs): Promise<DiffResult> {
    const replaces = (["issuer", "organizationId", "projectId"] as const).filter(
      key => olds[key] !== news[key],
    )
    return {
      changes:
        replaces.length > 0 ||
        olds.configurationDrift ||
        olds.token !== news.token ||
        olds.name !== news.name ||
        JSON.stringify(olds.redirectUris) !== JSON.stringify(news.redirectUris),
      replaces,
    }
  }

  async read(id: string, props?: ApplicationState): Promise<ReadResult<ApplicationState>> {
    if (!props) {
      throw new Error(
        "Reading a Zitadel application requires its management credentials and existing client secret",
      )
    }
    const result = await this.request<{ app: { name: string; oidcConfig: OidcConfig } }>(
      props,
      "GET",
      this.path(props, id),
    )
    if (!result) {
      return { id: undefined }
    }
    const config = result.app.oidcConfig
    if (!config || config.clientId !== props.clientId) {
      throw new Error("Zitadel application no longer matches the managed OIDC client")
    }
    const expected = this.config(props)
    const configurationDrift =
      config.authMethodType !== expected.authMethodType ||
      config.appType !== expected.appType ||
      config.version !== expected.version ||
      config.idTokenUserinfoAssertion !== expected.idTokenUserinfoAssertion ||
      JSON.stringify(config.responseTypes) !== JSON.stringify(expected.responseTypes) ||
      JSON.stringify(config.grantTypes) !== JSON.stringify(expected.grantTypes)
    const observed = {
      ...props,
      name: result.app.name,
      redirectUris: config.redirectUris ?? [],
      configurationDrift,
    }
    return { id, inputs: observed, props: observed }
  }

  async update(
    id: string,
    olds: ApplicationState,
    news: ApplicationInputs,
  ): Promise<UpdateResult<ApplicationState>> {
    if (olds.name !== news.name) {
      await this.request(news, "PUT", this.path(news, id), { name: news.name })
    }
    if (
      olds.configurationDrift ||
      JSON.stringify(olds.redirectUris) !== JSON.stringify(news.redirectUris)
    ) {
      await this.request(news, "PUT", `${this.path(news, id)}/oidc_config`, this.config(news))
    }
    return {
      outs: {
        ...news,
        clientId: olds.clientId,
        clientSecret: olds.clientSecret,
        configurationDrift: false,
      },
    }
  }

  async delete(id: string, props: ApplicationState): Promise<void> {
    await this.request(props, "DELETE", this.path(props, id))
  }
}
