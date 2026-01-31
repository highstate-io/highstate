import { common, network } from "@highstate/library";

const { server } = common.existingServer({
  name: "example",
  args: {
    endpoint: "192.168.1.10",
  },
})

const { l3Endpoints } = network.endpointFilter({
  name: "example",
  args: {
    endpointFilter: `(level == l3 or port == 443) and type != "hostname"`,
  },
  inputs: {
    l3Endpoints: [server]
  }
})

common.serverPatch({
  name: "example",
  inputs:{
    server,
    endpoints: l3Endpoints,
  }
})
