import { text } from "@highstate/contract"

export const backupExcludes = [
  "/data/private/exetrouter.sqlite",
  "/data/private/exetrouter.sqlite-wal",
  "/data/private/exetrouter.sqlite-shm",
]

export const onlineBackupScript = text`
  #!/bin/sh
  set -eu
  umask 077
  test -s /data/private/exetrouter.sqlite
  test -s /data/private/exetrouter.key
  test -s /data/private/exetrouter.oauth.key
  sqlite3 /data/private/exetrouter.sqlite '.timeout 30000' '.backup /data/private/exetrouter.sqlite.backup'
`

export const postRestoreScript = text`
  #!/bin/sh
  set -eu
  test -s /data/private/exetrouter.sqlite.backup
  mv /data/private/exetrouter.sqlite.backup /data/private/exetrouter.sqlite
  chown 10001:10002 /data/private/exetrouter.sqlite
  chmod 600 /data/private/exetrouter.sqlite
`
