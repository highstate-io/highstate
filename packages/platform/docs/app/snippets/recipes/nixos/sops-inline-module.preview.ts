import { text } from "@highstate/contract"
import { common, git, nixos, sops } from "@highstate/library"

// split the SOPS wiring into a reusable inline module
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

const { folder: secretsModule } = nixos.inlineModule({
  name: "database",
  args: {
    code: `{
      sops.secrets.database = {
        sopsFile = ./secrets.json;
      };
    }`,
  },
  inputs: {
    files: [encryptedFile],
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
            ./database
          ];
        };
      };
    }`,
  },
  inputs: {
    folders: [examples, secretsModule],
  },
})

nixos.system({
  name: "nixos-sops-module",
  inputs: {
    server,
    flake,
  },
})
