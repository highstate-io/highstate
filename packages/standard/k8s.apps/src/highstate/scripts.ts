/**
 * Runs outside the managed Highstate runtime, including for before-destroy triggers.
 */
export const coordinateBackupScript = `set -eu
: "\${NAMESPACE:?}" "\${DEPLOYMENT:?}" "\${BACKUP_TEMPLATE:?}"
lock=highstate-backup-lock
job="highstate-backup-$(date +%s)"
kubectl -n "$NAMESPACE" create configmap "$lock" --from-literal=job="$job"
stopping=false
cleanup() {
  status=$?
  if [ "$stopping" = false ]; then
    kubectl -n "$NAMESPACE" delete configmap "$lock" || true
  elif [ "$status" != 0 ]; then
    kubectl -n "$NAMESPACE" logs "job/$job" >&2 || true
    printf '%s\\n' "Backup failed; inspect job/$job and $lock before resuming" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Once shutdown is attempted, failures deliberately keep the maintenance lock.
replicas=$(kubectl -n "$NAMESPACE" get deployment "$DEPLOYMENT" -o jsonpath='{.spec.replicas}')
case "$replicas" in 0|1) ;; *) exit 1 ;; esac
stopping=true
kubectl -n "$NAMESPACE" scale deployment "$DEPLOYMENT" --current-replicas="$replicas" --replicas=0
kubectl -n "$NAMESPACE" rollout status "deployment/$DEPLOYMENT" --timeout=600s
wait_for_pods() {
  attempts=0
  while true; do
    pods=$(kubectl -n "$NAMESPACE" get pods -l "$1" -o name) || return 1
    [ -n "$pods" ] || return 0
    attempts=$((attempts + 1))
    [ "$attempts" -lt 120 ] || return 1
    sleep 5
  done
}
wait_for_pods "app.kubernetes.io/name=$DEPLOYMENT"
kubectl -n "$NAMESPACE" create job "$job" --from="cronjob/$BACKUP_TEMPLATE"
kubectl -n "$NAMESPACE" wait --for=condition=complete "job/$job" --timeout=3600s
kubectl -n "$NAMESPACE" logs "job/$job"
kubectl -n "$NAMESPACE" delete job "$job" --wait=true
wait_for_pods "job-name=$job"
if [ "\${RESUME:-true}" = true ]; then
  kubectl -n "$NAMESPACE" scale deployment "$DEPLOYMENT" --current-replicas=0 --replicas="$replicas"
  kubectl -n "$NAMESPACE" rollout status "deployment/$DEPLOYMENT" --timeout=600s
fi
kubectl -n "$NAMESPACE" delete configmap "$lock"
`

/**
 * Captures the complete stopped encrypted libSQL tree, including WAL and key envelopes.
 */
export const offlineBackupScript = `set -eu
umask 077
kubectl -n "$NAMESPACE" get configmap highstate-backup-lock >/dev/null
replicas=$(kubectl -n "$NAMESPACE" get deployment "$DEPLOYMENT" -o jsonpath='{.spec.replicas}')
test "$replicas" = 0
pods=$(kubectl -n "$NAMESPACE" get pods -l "app.kubernetes.io/name=$DEPLOYMENT" -o name)
test -z "$pods"
restic snapshots >/dev/null
mkdir -p /backup/recovery
cp -R /recovery/. /backup/recovery/
pg_dump --dbname="$HIGHSTATE_BACKEND_DATABASE_POSTGRESQL_URL" --format=custom --no-owner --no-acl --file=/backup/backend.pgdump
printf '%s\\n' "$HIGHSTATE_BACKUP_MANIFEST" > /backup/manifest.json
date -u +%FT%TZ > /backup/captured-at
restic backup --host highstate --tag highstate-coordinated /data /backup
`
