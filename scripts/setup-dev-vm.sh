#!/usr/bin/env bash

set -euo pipefail

# Override these defaults by exporting environment variables before running the script.
: "${DEV_USER:=dev}"
: "${DEV_SSH_PUBLIC_KEY:=}"
: "${DEV_PASSWORDLESS_SUDO:=true}"
: "${ENABLE_DOCKER:=true}"
: "${ENABLE_OPENCODE:=true}"
: "${DEV_SSH_KEY_PATH:=.ssh/id_ed25519}"
: "${NIX_PROFILE:=/nix/var/nix/profiles/dev-tools}"
: "${NIX_PACKAGES:=nixpkgs#bun nixpkgs#devenv nixpkgs#gcc nixpkgs#gh nixpkgs#git nixpkgs#gnumake nixpkgs#jq nixpkgs#nix nixpkgs#nodejs_24 nixpkgs#pkg-config nixpkgs#skills}"

if [[ $EUID -ne 0 ]]; then
  printf 'Run this script as root on the VM\n' >&2
  exit 1
fi

if [[ ! "$DEV_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  printf 'DEV_USER must be a valid Linux user name\n' >&2
  exit 1
fi

if [[ "$NIX_PROFILE" != /* || "$NIX_PROFILE" == *$'\n'* ]]; then
  printf 'NIX_PROFILE must be an absolute path without newlines\n' >&2
  exit 1
fi

if [[ "$DEV_SSH_KEY_PATH" == /* || "$DEV_SSH_KEY_PATH" == *$'\n'* || \
  "$DEV_SSH_KEY_PATH" == ../* || "$DEV_SSH_KEY_PATH" == */../* ]]; then
  printf 'DEV_SSH_KEY_PATH must be a relative path inside the development user home\n' >&2
  exit 1
fi

for value in "$DEV_PASSWORDLESS_SUDO" "$ENABLE_DOCKER" "$ENABLE_OPENCODE"; do
  if [[ "$value" != true && "$value" != false ]]; then
    printf 'Boolean configuration values must be either true or false\n' >&2
    exit 1
  fi
done

if [[ ! -f /etc/debian_version ]]; then
  printf 'This reference setup script supports Debian and Ubuntu VMs\n' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
packages=(ca-certificates curl openssh-server sudo xz-utils)
if [[ "$ENABLE_DOCKER" == true ]]; then
  packages+=(docker.io)
fi
apt-get install -y "${packages[@]}"

if [[ -n "$DEV_SSH_PUBLIC_KEY" ]]; then
  if [[ "$DEV_SSH_PUBLIC_KEY" == *$'\n'* ]] || \
    ! ssh-keygen -l -f <(printf '%s\n' "$DEV_SSH_PUBLIC_KEY") >/dev/null 2>&1; then
    printf 'DEV_SSH_PUBLIC_KEY must contain one valid SSH public key\n' >&2
    exit 1
  fi
fi

if ! id "$DEV_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEV_USER"
fi

dev_home="$(getent passwd "$DEV_USER" | cut -d: -f6)"
dev_group="$(id -gn "$DEV_USER")"
if [[ -z "$dev_home" || ! -d "$dev_home" ]]; then
  printf 'Could not resolve the home directory for %s\n' "$DEV_USER" >&2
  exit 1
fi

dev_ssh_key="$dev_home/$DEV_SSH_KEY_PATH"
install -d -m 0700 -o "$DEV_USER" -g "$dev_group" "$(dirname "$dev_ssh_key")"
if [[ ! -f "$dev_ssh_key" ]]; then
  runuser -u "$DEV_USER" -- ssh-keygen -q -t ed25519 -N '' -C "$DEV_USER@$(hostname)" -f "$dev_ssh_key"
fi
if [[ ! -f "$dev_ssh_key.pub" ]]; then
  # The positional parameter keeps the path out of the command string.
  # shellcheck disable=SC2016
  runuser -u "$DEV_USER" -- sh -c 'ssh-keygen -y -f "$1" >"$1.pub"' sh "$dev_ssh_key"
fi
chown "$DEV_USER:$dev_group" "$dev_ssh_key" "$dev_ssh_key.pub"
chmod 0600 "$dev_ssh_key"
chmod 0644 "$dev_ssh_key.pub"

usermod -aG sudo "$DEV_USER"
if [[ "$DEV_PASSWORDLESS_SUDO" == true ]]; then
  printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$DEV_USER" >"/etc/sudoers.d/90-$DEV_USER"
  chmod 0440 "/etc/sudoers.d/90-$DEV_USER"
  visudo --check --file "/etc/sudoers.d/90-$DEV_USER" >/dev/null
else
  rm -f "/etc/sudoers.d/90-$DEV_USER"
fi

if [[ -n "$DEV_SSH_PUBLIC_KEY" ]]; then
  install -d -m 0700 -o "$DEV_USER" -g "$dev_group" "$dev_home/.ssh"
  touch "$dev_home/.ssh/authorized_keys"
  chown "$DEV_USER:$dev_group" "$dev_home/.ssh/authorized_keys"
  chmod 0600 "$dev_home/.ssh/authorized_keys"
  if ! grep -qxF "$DEV_SSH_PUBLIC_KEY" "$dev_home/.ssh/authorized_keys"; then
    printf '%s\n' "$DEV_SSH_PUBLIC_KEY" >>"$dev_home/.ssh/authorized_keys"
  fi
fi

systemctl enable --now ssh

if [[ "$ENABLE_DOCKER" == true ]]; then
  usermod -aG docker "$DEV_USER"
  systemctl enable --now docker
  docker info >/dev/null
fi

if [[ ! -x /nix/var/nix/profiles/default/bin/nix ]]; then
  curl --proto '=https' --tlsv1.2 -fsSL https://nixos.org/nix/install | sh -s -- --daemon --yes
fi

read -r -a nix_packages <<<"$NIX_PACKAGES"
if [[ ${#nix_packages[@]} -eq 0 ]]; then
  printf 'NIX_PACKAGES must contain at least one package\n' >&2
  exit 1
fi

/nix/var/nix/profiles/default/bin/nix \
  --extra-experimental-features 'nix-command flakes' \
  profile install --profile "$NIX_PROFILE" "${nix_packages[@]}"

cat >/etc/profile.d/highstate-dev-environment.sh <<EOF
export PATH="$NIX_PROFILE/bin:\$PATH"
EOF
chmod 0644 /etc/profile.d/highstate-dev-environment.sh

for executable in "$NIX_PROFILE"/bin/*; do
  ln -sfn "$executable" "/usr/local/bin/$(basename "$executable")"
done

cat >/usr/local/bin/orca-ide <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

orca_path="$(command -v orca || true)"
if [[ -z "$orca_path" ]]; then
  printf 'The Orca CLI command "orca" is not available in this environment\n' >&2
  exit 127
fi
exec "$orca_path" "$@"
EOF
chmod 0755 /usr/local/bin/orca-ide

if ! grep -q '^# Highstate devenv activation$' /etc/bash.bashrc; then
  cat >>/etc/bash.bashrc <<'EOF'

# Highstate devenv activation
if [[ $- == *i* ]] && command -v devenv >/dev/null 2>&1; then
  eval "$(devenv hook bash)"
fi
EOF
fi

if [[ "$ENABLE_OPENCODE" == true && ! -x "$dev_home/.opencode/bin/opencode" ]]; then
  runuser -u "$DEV_USER" -- env HOME="$dev_home" \
    bash -c "curl -fsSL https://opencode.ai/install | bash"
fi

printf '\nDevelopment VM setup complete.\n'
printf 'User: %s\n' "$DEV_USER"
printf 'User SSH public key:\n%s\n' "$(<"$dev_ssh_key.pub")"
if [[ -n "$DEV_SSH_PUBLIC_KEY" ]]; then
  printf 'SSH public key installed for %s.\n' "$DEV_USER"
else
  printf 'No SSH public key was installed. Set DEV_SSH_PUBLIC_KEY and rerun to add one.\n'
fi
