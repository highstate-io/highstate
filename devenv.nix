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
  env =
    prisma.env
    // {
      # for making screenshots with playwright for documentation
      CHROMIUM_PATH = "${pkgs.chromium}/bin/chromium";
    };

  packages = with pkgs; [
    bun
    nodejs_24
    chromium
    crd2pulumi
    kubectl
    pkgs-unstable.kubernetes-helm
    cilium-cli
    talosctl
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

    # for libavoid-rust
    rustup
    rustc
    cargo
    wasm-pack
    wasm-bindgen-cli
    binaryen
  ];
}
