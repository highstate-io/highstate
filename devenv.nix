{
  pkgs,
  inputs,
  ...
}: let
  pkgs-unstable = import inputs.nixpkgs-unstable {system = pkgs.stdenv.system;};

  prisma = inputs.prisma-utils.lib.prisma-factory {
    inherit pkgs;
    hash = "sha256-dzjXzESZPHh3OvkqkPDzyaeRuoqSOe+8rysUsI6Bs8M=";
    pnpmLock = ./pnpm-lock.yaml;
  };
in {
  languages.javascript.enable = true;
  languages.javascript.package = pkgs.nodejs_24;
  languages.javascript.corepack.enable = true;

  env =
    prisma.env
    // {
      CHROMIUM_PATH = "${pkgs.chromium}/bin/chromium";
    };

  packages = with pkgs; [
    pkgs-unstable.pulumi-bin
    pkgs-unstable.pulumiPackages.pulumi-nodejs
    chromium
    crd2pulumi
    kubectl
    pkgs-unstable.kubernetes-helm
    cilium-cli
    talosctl
    nodejs_24
    yq-go
    jq
    terraform
    nixos-anywhere
    sops
    ssh-to-age
    clang-tools
    protobuf
    grpc-tools
    python3
  ];
}
