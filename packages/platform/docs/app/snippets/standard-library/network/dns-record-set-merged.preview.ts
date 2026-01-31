import { cloudflare, common, dns } from "@highstate/library";

const { server } = common.existingServer({
  name: "example",
  args: {
    endpoint: "192.168.1.10",
  },
})

const { dnsProvider } = cloudflare.connection({
  name: "main",
})

const { l3Endpoints } = dns.recordSet({
  name: "server.mydomain.com",
  args: {
    endpointFilter: `type != "hostname"`,
  },
  inputs: {
    dnsProviders: [dnsProvider],
    l3Endpoints: [server],
  }
})

common.serverPatch({
  name: "with-all-endpoints",
  inputs:{
    server,
    endpoints: [server, ...l3Endpoints],
  }
})
