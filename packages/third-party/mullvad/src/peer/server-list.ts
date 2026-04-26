import type { Output } from "@highstate/pulumi"
import { getHttpOutput } from "@pulumi/http"

export type Server = {
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

export function fetchServerList(): Output<Server[]> {
  const response = getHttpOutput({
    url: "https://api.mullvad.net/www/relays/all/",
    requestHeaders: {
      Accept: "application/json",
    },
  })

  return response.responseBody.apply(rawBody => JSON.parse(rawBody) as Server[])
}
