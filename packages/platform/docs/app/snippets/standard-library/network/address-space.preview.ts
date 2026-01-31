import { network } from "@highstate/library";

network.addressSpace({
  name: "example",
  args: {
    included: ["0.0.0.0/0", "10.0.0.10-10.0.0.20"],
    excluded: ["192.168.0.0/16"],
  },
});
