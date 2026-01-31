import { common, ssh } from "@highstate/library";

const { keyPair } = ssh.keyPair({
  name: "ssh-key",
});

common.existingServer({
  name: "example",
  args: {
    endpoint: "192.168.1.10",
  },
  inputs: {
    sshKeyPair: keyPair,
  },
});
