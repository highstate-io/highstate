import type { ScriptEnvironment } from "@highstate/k8s"
import { text } from "@highstate/contract"

export const baseEnvironment: ScriptEnvironment = {
  alpine: {
    packages: ["mariadb-client"],
  },

  ubuntu: {
    packages: ["mariadb-client"],
  },

  setupScripts: {
    "configure-mysql-client.sh": text`
      #!/bin/sh
      set -e

      cat > /root/.my.cnf <<EOF
      [client]
      user=root
      password="$MARIADB_ROOT_PASSWORD"
      EOF
    `,
  },
}

// only for ubuntu, because mariadb-backup is segfaulting on alpine
// https://jira.mariadb.org/browse/MDEV-34299
export const backupEnvironment: ScriptEnvironment = {
  ubuntu: {
    packages: ["mariadb-backup"],
  },

  files: {
    "online-backup.sh": text`
      #!/bin/sh
      set -e

      echo "| Starting online backup using mariabackup..."
      mariabackup --backup --target-dir=/data --host=$DATABASE_HOST --port=$DATABASE_PORT --user=root --password="$MARIADB_ROOT_PASSWORD"
      echo "| Online backup completed"
    `,

    "post-restore.sh": text`
      #!/bin/sh
      set -e

      echo "| Preparing backup using mariabackup..."
      mariabackup --prepare --target-dir=/data
      echo "| Backup prepared"
    `,
  },
}

export const initEnvironment: ScriptEnvironment = {
  files: {
    "init-database.sh": text`
      #!/bin/sh
      set -e

      echo "Ensuring database exists..."
      mariadb --skip-ssl-verify-server-cert -h $DATABASE_HOST -P $DATABASE_PORT -u root -e "CREATE DATABASE IF NOT EXISTS $DATABASE_NAME;"

      echo "Ensuring user exists..."
      mariadb --skip-ssl-verify-server-cert -h $DATABASE_HOST -P $DATABASE_PORT -u root -e "CREATE USER IF NOT EXISTS '$DATABASE_USER'@'%' IDENTIFIED BY '$DATABASE_PASSWORD';"

      echo "Ensuring user password is up-to-date..."
      mariadb --skip-ssl-verify-server-cert -h $DATABASE_HOST -P $DATABASE_PORT -u root -e "ALTER USER '$DATABASE_USER'@'%' IDENTIFIED BY '$DATABASE_PASSWORD';"

      echo "Ensuring user has access to database..."
      mariadb --skip-ssl-verify-server-cert -h $DATABASE_HOST -P $DATABASE_PORT -u root -e "GRANT ALL PRIVILEGES ON $DATABASE_NAME.* TO '$DATABASE_USER'@'%';"
      mariadb --skip-ssl-verify-server-cert -h $DATABASE_HOST -P $DATABASE_PORT -u root -e "FLUSH PRIVILEGES;"

      echo "Database initialization complete"
    `,
  },
}
