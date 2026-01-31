import { common } from "@highstate/library";

common.existingServer({
  name: "example",
  args: {
    endpoint: "192.168.1.10",
  },
});
