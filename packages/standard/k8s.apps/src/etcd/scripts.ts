import type { ScriptEnvironment } from "@highstate/k8s"
import { text } from "@highstate/contract"

export const backupEnvironment: ScriptEnvironment = {
  alpine: {
    packages: ["etcd"],
  },

  files: {
    "online-backup.sh": text`
      #!/bin/sh
      set -e

      if ! command -v etcdctl >/dev/null 2>&1; then
        echo "| error: etcdctl is not available"
        exit 1
      fi

      if [ -z "$DATABASE_HOST" ]; then
        echo "| error: DATABASE_HOST is required"
        exit 1
      fi

      if [ -z "$DATABASE_PORT" ]; then
        echo "| error: DATABASE_PORT is required"
        exit 1
      fi

      export ETCDCTL_API=3

      SNAPSHOT_PATH="/data/snapshot.db.tmp"

      echo "| creating etcd snapshot"
      rm -f "$SNAPSHOT_PATH"
      etcdctl --endpoints="$DATABASE_HOST:$DATABASE_PORT" snapshot save "$SNAPSHOT_PATH"
      mv "$SNAPSHOT_PATH" /data/snapshot.db
      echo "| snapshot saved to /data/snapshot.db"
    `,
  },
}
