FROM ghcr.io/mocki-toki/exetrouter@sha256:dcca8f2113142389a20db1a9a19e7e63573583b3edc1a4b417702f7c4688f152

USER root
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server util-linux \
    && rm -rf /var/lib/apt/lists/* /etc/ssh/ssh_host_* \
    && groupadd --gid 10002 exetrouter \
    && useradd --uid 10001 --gid 10002 --no-create-home --shell /usr/sbin/nologin exetrouter \
    && useradd --uid 10003 --gid 10002 --no-create-home --home-dir /var/empty --shell /bin/sh routercli \
    && passwd -d routercli \
    && mkdir -p /run/sshd /var/empty /etc/exetrouter

COPY entrypoint.sh /usr/local/bin/highstate-exetrouter
COPY sshd.conf /etc/ssh/exetrouter.conf
RUN chmod 755 /usr/local/bin/highstate-exetrouter
ENV EXRD_CONFIG=/etc/exetrouter/config.json
ENTRYPOINT ["/usr/local/bin/highstate-exetrouter"]
CMD ["api"]
