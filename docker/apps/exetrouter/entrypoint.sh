#!/bin/bash
set -euo pipefail

case "${1:-}" in
  prepare)
    install -d -m 700 -o 10001 -g 10002 /state/private
    install -d -m 750 -o 10001 -g 10002 /run/exetrouter
    install -d -m 700 /state/ssh
    if [[ ! -e /state/private/exetrouter.sqlite ]]; then
      runuser -u exetrouter -- exrd init
    fi
    # validate existing state without contacting upstream services
    runuser -u exetrouter -- exrd admin user-list >/dev/null
    if [[ ! -e /state/ssh/ssh_host_ed25519_key ]]; then
      ssh-keygen -q -t ed25519 -N '' -f /state/ssh/ssh_host_ed25519_key
    fi
    ;;
  api)
    export_keys() {
      exrd admin ssh-authorized-keys --gateway-bin /usr/local/bin/exrd > /run/exetrouter/authorized_keys.new
      chmod 640 /run/exetrouter/authorized_keys.new
      mv /run/exetrouter/authorized_keys.new /run/exetrouter/authorized_keys
    }
    export_keys
    exrd serve --allow-container-listen &
    api_pid=$!
    (
      while sleep 5; do export_keys; done
    ) &
    keys_pid=$!
    trap 'kill "$api_pid" "$keys_pid" 2>/dev/null || true; wait || true' EXIT
    trap 'exit 0' TERM INT
    wait -n "$api_pid" "$keys_pid"
    ;;
  ssh)
    exec /usr/sbin/sshd -D -e -f /etc/ssh/exetrouter.conf
    ;;
  *)
    exec "$@"
    ;;
esac
