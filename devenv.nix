{
  pkgs,
  inputs,
  ...
}: let
  pkgs-unstable = import inputs.nixpkgs-unstable {system = pkgs.stdenv.system;};

  prisma = inputs.prisma-utils.lib.prisma-factory {
    inherit pkgs;
    hash = "sha256-H3iZMOF0JJ2dUUGwhu3zPfRMX3gjWkhnJSHYSSsh8i4=";
    versionString = "7.4.1-55ae170b1ced7fc6ed07a15f110549408c501bb3";
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
