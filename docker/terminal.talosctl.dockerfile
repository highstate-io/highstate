FROM terminal-kubectl

ARG TARGETARCH

RUN apk add --no-cache curl

RUN curl -Lo /usr/local/bin/talosctl https://github.com/siderolabs/talos/releases/latest/download/talosctl-linux-${TARGETARCH}
RUN chmod +x /usr/local/bin/talosctl
