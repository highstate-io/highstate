import { type CustomResourceOptions, dynamic, type Output } from "@highstate/pulumi"

type Server = {
  hostname: string
  country_code: string
  country_name: string
  city_code: string
  city_name: string
  fqdn: string
  active: boolean
  owned: boolean
  provider: string
  ipv4_addr_in: string
  ipv6_addr_in: string
  network_port_speed: number
  stboot: boolean
  pubkey: string
  multihop_port: number
  socks_name: string
  socks_port: number
  daita: boolean
  type: string
  status_messages: string[]
}

class ServerListProvider implements dynamic.ResourceProvider {
  async create(): Promise<dynamic.CreateResult> {
    const servers = await fetchServers()

    return { id: "all", outs: { servers } }
  }

  async update(): Promise<dynamic.UpdateResult> {
    return { outs: { servers: await fetchServers() } }
  }

  async read(): Promise<dynamic.ReadResult> {
    return { props: { servers: await fetchServers() } }
  }
}

export type ServerListArgs = {
  /**
   * The current time from `Date.now()` to trigger a refresh.
   */
  now: number
}

export class ServerList extends dynamic.Resource {
  declare readonly servers: Output<Server[]>

  constructor(name: string, args: ServerListArgs, opts?: CustomResourceOptions) {
    super(new ServerListProvider(), name, { servers: undefined, ...args }, opts)
  }
}

async function fetchServers(): Promise<Server[]> {
  const response = await fetch("https://api.mullvad.net/www/relays/all/")

  return (await response.json()) as Server[]
}
