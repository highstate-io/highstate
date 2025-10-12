import { common } from "@highstate/library"

common.existingServer({
  name: "my-awesome-server",
  args: {
    endpoint: "example.com:22",
  },
})
