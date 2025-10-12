import { text } from "@highstate/contract"
import { common, nixos } from "@highstate/library"

// same install flow, but we bring our own machine and flake
const { server } = common.existingServer({
  name: "server",
  args: {
    endpoint: "10.0.0.1",
  },
})

const { folder: flake } = nixos.inlineFlake({
  name: "inline-flake",
  args: {
    code: text`{
      outputs = { self, nixpkgs, ... }: {
        nixosConfigurations.generic = nixpkgs.lib.nixosSystem {
          system = "x86_64-linux";
          modules = [
            ({ pkgs, ... }: {
              environment.systemPackages = [ pkgs.vim ];
            })
          ];
        };
      };
    }`,
  },
})

nixos.system({
  name: "nixos-inline",
  inputs: {
    server,
    flake,
  },
})
