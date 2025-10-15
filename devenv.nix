{
  pkgs,
  inputs,
  ...
}: let
  pkgs-unstable = import inputs.nixpkgs-unstable {system = pkgs.stdenv.system;};

  prisma =
    (inputs.prisma-utils.lib.prisma-factory {
      inherit pkgs;

      prisma-fmt-hash = "sha256-eGKy8W30blEY1izsOOhq95IjOtJmdS6m+st+AgnCf+A=";
      libquery-engine-hash = "sha256-Oq+YPmGRQK5Zop0WAl9KLH/sURdVZAWhX3/i+INVY38=";
      query-engine-hash = "sha256-PNIG/mQuc5qHTAwH1lbRQKtX2/dtBrKNeJunOAGus2s=";
      schema-engine-hash = "sha256-A0Pwhw9J83VlqdsTw6D+byUgkB45DIotR7lxFTh/Wv4=";
    })
    .fromPnpmLock
    ./pnpm-lock.yaml;
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
