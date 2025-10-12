import { text } from "@highstate/contract"
import { common, git, nixos, sops } from "@highstate/library"

// encrypt secrets with the host key of a server that is already reachable over SSH
const { server } = common.existingServer({
  name: "server",
  args: {
    endpoint: "10.0.0.1",
  },
})

const { file: encryptedFile } = sops.secrets({
  name: "secrets",
  inputs: {
    servers: [server],
  },
})

const { folder: examples } = git.remoteRepository({
  name: "examples",
  args: {
    url: "https://github.com/Exeteres/nixos-anywhere-examples",
  },
})

const { folder: flake } = nixos.inlineFlake({
  name: "flake",
  args: {
    code: text`{
      outputs = { nixos-anywhere-examples, ... }: {
        nixosConfigurations.generic = nixos-anywhere-examples.nixosConfigurations.generic.extendModules {
          modules = [
            ({ ... }: {
              sops.secrets.database = {
                sopsFile = ./secrets.json;
              };
            })
          ];
        };
      };
    }`,
  },
  inputs: {
    folders: [examples],
    files: [encryptedFile],
  },
})

nixos.system({
  name: "nixos-sops",
  inputs: {
    server,
    flake,
  },
})
