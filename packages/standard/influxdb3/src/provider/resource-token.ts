import type { influxdb3 } from "@highstate/library"
import {
  type CustomResourceOptions,
  dynamic,
  type Input,
  type InputArray,
  type Output,
  type Unwrap,
} from "@highstate/pulumi"
import { apiRequest } from "./api"

export type ResourceAction = "read" | "write"

export type TokenPermission = {
  resource_type: "db"
  resource_names: InputArray<string>
  actions: InputArray<ResourceAction>
}

export type ResourceTokenArgs = {
  /**
   * The connection to the InfluxDB 3 instance.
   */
  connection: Input<influxdb3.Connection>

  /**
   * The token description (for organizational purposes).
   */
  token_name: Input<string>

  /**
   * The list of permissions granted by the token.
   */
  permissions: Input<TokenPermission[]>

  /**
   * The token expiration in seconds.
   */
  expiry_secs: Input<number>
}

type TokenCreateResponse = {
  token: string
}

class ResourceTokenProvider implements dynamic.ResourceProvider {
  async create(props: Unwrap<ResourceTokenArgs>): Promise<dynamic.CreateResult> {
    const response = await apiRequest<TokenCreateResponse>({
      connection: props.connection,
      method: "POST",
      path: "/api/v3/configure/token",
      body: props,
    })

    return {
      id: props.token_name,
      outs: {
        connection: props.connection,
        token_name: props.token_name,
        permissions: props.permissions,
        expiry_secs: props.expiry_secs,
        token: response.token,
      },
    }
  }

  async delete(_id: string, props: Unwrap<ResourceTokenArgs>): Promise<void> {
    await apiRequest({
      connection: props.connection,
      method: "DELETE",
      path: "/api/v3/configure/token",
      queryParams: { token_name: props.token_name },
    })
  }

  async diff(
    _id: string,
    olds: ResourceTokenArgs,
    news: ResourceTokenArgs,
  ): Promise<dynamic.DiffResult> {
    const replaces: string[] = []

    if (olds.token_name !== news.token_name) {
      replaces.push("token_name")
    }

    if (olds.expiry_secs !== news.expiry_secs) {
      replaces.push("expiry_secs")
    }

    if (JSON.stringify(olds.permissions) !== JSON.stringify(news.permissions)) {
      replaces.push("permissions")
    }

    return {
      changes: replaces.length > 0,
      replaces,
      deleteBeforeReplace: true,
    }
  }
}

/**
 * Creates an InfluxDB 3 enterprise resource token.
 *
 * The API does not support querying the token by ID,
 * so this resource relies on stored state for refresh.
 */
export class ResourceToken extends dynamic.Resource {
  declare readonly token_name: Output<string>
  declare readonly permissions: Output<TokenPermission[]>
  declare readonly expiry_secs: Output<number>
  declare readonly token: Output<string>

  constructor(name: string, args: ResourceTokenArgs, opts?: CustomResourceOptions) {
    super(new ResourceTokenProvider(), name, { token: undefined, ...args }, opts)
  }
}
