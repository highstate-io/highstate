import type { ScriptEnvironment } from "@highstate/k8s"
import { text } from "@highstate/contract"

export const baseEnvironment: ScriptEnvironment = {
  alpine: {
    packages: ["postgresql-client"],
  },
}

export const backupEnvironment: ScriptEnvironment = {
  files: {
    "online-backup.sh": text`
      #!/bin/sh
      set -e

      echo "| Starting online backup using pg_basebackup..."
      pg_basebackup -h $DATABASE_HOST -p $DATABASE_PORT -U postgres -D /data --checkpoint=fast --wal-method=stream
      echo "| Online backup completed"
    `,

    "post-restore.sh": text`
      #!/bin/sh
      set -e

      echo "Restoring database permissions..."
      chown -R 999:999 /data
    `,
  },
}
