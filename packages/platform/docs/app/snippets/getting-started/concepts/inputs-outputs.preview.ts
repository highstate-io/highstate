import { common, k3s } from "@highstate/library"

const { server } = common.existingServer({
  name: "server-for-cluster",
  args: {
    endpoint: "10.0.0.1",
  },
})

k3s.cluster({
  name: "my-k3s-cluster",
  inputs: {
    masters: [server],
  },
})
