ARG BASE_IMAGE
FROM $BASE_IMAGE

RUN apk add --no-cache curl

RUN curl -Lo /usr/local/bin/talosctl https://github.com/siderolabs/talos/releases/latest/download/talosctl-linux-amd64
RUN chmod +x /usr/local/bin/talosctl
