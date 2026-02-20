import type { ScriptEnvironment } from "@highstate/k8s"
import { text } from "@highstate/contract"

export const baseEnvironment: ScriptEnvironment = {
  alpine: {
    packages: ["curl"],
  },

  ubuntu: {
    packages: ["curl"],
  },
}

export const initEnvironment: ScriptEnvironment = {
  files: {
    "init-database.sh": text`
      #!/bin/sh
      set -e

      BASE_URL="http://$DATABASE_HOST:$DATABASE_PORT"

      echo "Ensuring database exists..."
      curl -fsS -u "$INFLUXDB_ROOT_USERNAME:$INFLUXDB_ROOT_PASSWORD" \
        -X POST "$BASE_URL/query" \
        --data-urlencode "q=CREATE DATABASE \"$DATABASE_NAME\"" >/dev/null

      echo "Ensuring user exists..."
      curl -fsS -u "$INFLUXDB_ROOT_USERNAME:$INFLUXDB_ROOT_PASSWORD" \
        -X POST "$BASE_URL/query" \
        --data-urlencode "q=CREATE USER \"$DATABASE_USER\" WITH PASSWORD '$DATABASE_PASSWORD'" >/dev/null

      echo "Ensuring user has access to database..."
      curl -fsS -u "$INFLUXDB_ROOT_USERNAME:$INFLUXDB_ROOT_PASSWORD" \
        -X POST "$BASE_URL/query" \
        --data-urlencode "q=GRANT ALL ON \"$DATABASE_NAME\" TO \"$DATABASE_USER\"" >/dev/null

      echo "Database initialization complete"
    `,
  },
}
