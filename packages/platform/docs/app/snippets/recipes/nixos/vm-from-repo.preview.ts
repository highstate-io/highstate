import { common, git, nixos } from "@highstate/library"

// reference an existing machine that already accepts SSH connections
const { server } = common.existingServer({
  name: "server",
  args: {
    endpoint: "10.0.0.1",
  },
})

// pull the flake from Git and hand the snapshot to the installer
const { folder: flake } = git.remoteRepository({
  name: "nixos-flake",
  args: {
    url: "https://github.com/Exeteres/nixos-anywhere-examples",
    ref: "main",
  },
})

nixos.system({
  name: "nixos-from-git",
  args: {
    system: "generic",
  },
  inputs: {
    server,
    flake,
  },
})
