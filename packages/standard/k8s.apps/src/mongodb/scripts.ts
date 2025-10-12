import type { ScriptEnvironment } from "@highstate/k8s"
import { text } from "@highstate/contract"

export const backupEnvironment: ScriptEnvironment = {
  files: {
    "online-backup.sh": text`
      #!/bin/sh
      set -e

      echo "| Starting online backup of all databases using mongodump..."
      mongodump --host $DATABASE_HOST --username root --password "$MONGODB_ROOT_PASSWORD" --authenticationDatabase admin --out /data
      echo "| Online backup completed"
    `,

    "post-restore.sh": text`
    #!/bin/sh
    set -e

    echo "| Restoring backup of all databases using mongorestore..."
    mongorestore --host $DATABASE_HOST --username root --password "$MONGODB_ROOT_PASSWORD" --authenticationDatabase admin /data
    echo "| Backup restored"
  `,
  },
}

export const initEnvironment: ScriptEnvironment = {
  files: {
    "init-database.sh": text`
      #!/bin/sh
      set -e

      echo "Ensuring target database user exists..."

      mongosh --host $DATABASE_HOST -u root -p "$MONGODB_ROOT_PASSWORD" --authenticationDatabase admin <<EOF
      use $DATABASE_NAME
      var user = db.getUser("$DATABASE_USER");
      if (!user) {
        db.createUser({
          user: "$DATABASE_USER",
          pwd: "$DATABASE_PASSWORD",
          roles: [{ role: "readWrite", db: "$DATABASE_NAME" }]
        });
        print("User created");
      } else {
        db.updateUser("$DATABASE_USER", { pwd: "$DATABASE_PASSWORD" });
        print("User updated");
      }
      EOF

      echo "Database initialization complete"
    `,
  },
}
