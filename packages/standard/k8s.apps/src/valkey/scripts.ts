import type { ScriptEnvironment } from "@highstate/k8s"
import { text } from "@highstate/contract"

export const backupEnvironment: ScriptEnvironment = {
  alpine: {
    packages: ["redis"],
  },

  files: {
    "online-backup.sh": text`
      #!/bin/sh
      set -e

      CLI="$(command -v valkey-cli || command -v redis-cli)"
      if [ -z "$CLI" ]; then
        echo "| error: neither valkey-cli nor redis-cli is available"
        exit 1
      fi

      TMP_FILE="/data/dump.rdb.tmp"

      echo "| creating rdb snapshot with $CLI"
      rm -f "$TMP_FILE"
      "$CLI" -h "$DATABASE_HOST" -p "$DATABASE_PORT" --rdb "$TMP_FILE"
      mv "$TMP_FILE" /data/dump.rdb
      echo "| snapshot saved to /data/dump.rdb"
    `,
  },
}
