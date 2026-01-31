import { common,  } from "@highstate/library";


const { server } = common.existingServer({
  name: "example",
  args: {
    endpoint: "192.168.1.10",
  },
});

common.script({
  name: "setup",
  args: {
    script: "echo 'hello from highstate'",
  },
  inputs: {
    server,
  },
});
