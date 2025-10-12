{
  pkgs,
  inputs,
  ...
}: let
  pkgs-unstable = import inputs.nixpkgs-unstable {system = pkgs.stdenv.system;};

  prisma =
    (inputs.prisma-utils.lib.prisma-factory {
      inherit pkgs;

      prisma-fmt-hash = "sha256-ROsmQvRXtpClfj/de8hifTc4FVCMNT7u2Qwie+G7l1Y=";
      query-engine-hash = "sha256-bIkXzxjR7exW1US2XJAFedpCo7huuDjDIUE4bGmSSs0=";
      libquery-engine-hash = "sha256-8VL8/jmWR325PXFwrzIoNSTtRxiQ9SXDjXoUmfeVxgU=";
      schema-engine-hash = "sha256-jSM/yfKACWAFwmbXDDL9VO1oGIiILyYDFXXTfcSWbwA=";
    })
    .fromYarnLock
    ./yarn.lock;
in {
  languages.javascript.enable = true;
  languages.javascript.package = pkgs.nodejs_24;
  languages.javascript.corepack.enable = true;

  env = prisma.env;

  packages = with pkgs; [
    pkgs-unstable.pulumi-bin
    pkgs-unstable.pulumiPackages.pulumi-nodejs
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
