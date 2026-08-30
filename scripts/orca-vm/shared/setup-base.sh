#!/usr/bin/env bash

set -euo pipefail

sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl docker.io xz-utils
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker
sudo docker info >/dev/null

if [[ ! -x /nix/var/nix/profiles/default/bin/nix ]]; then
  curl --proto '=https' --tlsv1.2 -fsSL https://nixos.org/nix/install | sh -s -- --daemon --yes
fi

shared_profile=/nix/var/nix/profiles/orca
sudo /nix/var/nix/profiles/default/bin/nix --extra-experimental-features 'nix-command flakes' \
  profile install \
  --profile "$shared_profile" \
  nixpkgs#bun \
  nixpkgs#devenv \
  nixpkgs#gcc \
  nixpkgs#git \
  nixpkgs#gnumake \
  nixpkgs#jq \
  nixpkgs#nix \
  nixpkgs#nodejs_24 \
  nixpkgs#pkg-config \
  nixpkgs#skills

sudo tee /etc/profile.d/orca-environment.sh >/dev/null <<EOF
export PATH="$shared_profile/bin:\$PATH"
EOF
sudo chmod 0644 /etc/profile.d/orca-environment.sh

if ! grep -q '^# Highstate Orca devenv activation$' /etc/bash.bashrc; then
  sudo tee -a /etc/bash.bashrc >/dev/null <<'EOF'

# Highstate Orca devenv activation
if [[ $- == *i* ]] && command -v devenv >/dev/null 2>&1; then
  eval "$(devenv hook bash)"
fi
EOF
fi

for executable in "$shared_profile"/bin/*; do
  sudo ln -sfn "$executable" "/usr/local/bin/$(basename "$executable")"
done

if [[ ! -x "$HOME/.opencode/bin/opencode" ]]; then
  curl -fsSL https://opencode.ai/install | bash
fi
if [[ ! -x "$HOME/.opencode/bin/opencode-real" ]]; then
  mv "$HOME/.opencode/bin/opencode" "$HOME/.opencode/bin/opencode-real"
fi

cat >"$HOME/.opencode/bin/opencode" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

real_opencode="$HOME/.opencode/bin/opencode-real"
if [[ -f "$PWD/devenv.nix" && -z "${DEVENV_ROOT:-}" ]]; then
  exec devenv shell -- "$real_opencode" "$@"
fi
exec "$real_opencode" "$@"
EOF
chmod 0755 "$HOME/.opencode/bin/opencode"

for executable in bun devenv git jq nix node skills; do
  test -x "$shared_profile/bin/$executable"
done
test -x "$HOME/.opencode/bin/opencode"
test -x "$HOME/.opencode/bin/opencode-real"
