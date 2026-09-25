#!/usr/bin/env bash
# Restore a Zenoeats backup into a throwaway database and prove it is whole.
#
#   scripts/restore_drill.sh                  the newest backup on the remote
#   scripts/restore_drill.sh 20261001T030000Z  that one
#   scripts/restore_drill.sh --keep ...       leave the scratch database running
#
# A backup that has never been restored is not a backup. Run this before
# launch, then monthly, and write down the time it prints: that is how long a
# real restore of the database takes.
#
# Run it on a machine that holds the age PRIVATE key -- not the production
# server, which only ever has the public one. It touches nothing but a
# scratch container of its own; production is never read or written.
#
# Settings (environment):
#   BACKUP_AGE_IDENTITY    required. The age private key file (AGE-SECRET-KEY-...).
#   BACKUP_RCLONE_REMOTE   required. The same target backup.sh copies to.
#
# It checks, and exits non-zero if any fails:
#   - the checksums match what backup.sh recorded
#   - pg_restore completes with no errors, into PostgreSQL 16 with the same
#     three roles production has
#   - row-level security is still switched on for the tenant tables
#   - every image a row refers to is in the images archive
#
# Needs: docker, age, rclone, tar, sha256sum.

set -Eeuo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
keep=0
if [[ "${1:-}" == "--keep" ]]; then keep=1; shift; fi
: "${BACKUP_AGE_IDENTITY:?set BACKUP_AGE_IDENTITY to the age private key file}"
: "${BACKUP_RCLONE_REMOTE:?set BACKUP_RCLONE_REMOTE}"

container=zenoeats-restore-drill
started=$(date +%s)
log() { echo "$(date -u +%H:%M:%S) $*"; }
fail() { echo "DRILL FAILED: $*" >&2; exit 1; }

tmp="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp"
  if [[ $keep -eq 0 ]]; then docker rm -f "$container" > /dev/null 2>&1 || true; fi
}
trap cleanup EXIT

stamp="${1:-$(rclone lsf --dirs-only "$BACKUP_RCLONE_REMOTE" | sed 's#/$##' | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort | tail -1)}"
[[ -n "$stamp" ]] || fail "no backups found at $BACKUP_RCLONE_REMOTE"
log "backup $stamp"

log "downloading"
rclone copy "$BACKUP_RCLONE_REMOTE/$stamp" "$tmp/enc"
(cd "$tmp/enc" && sha256sum --quiet -c "SHA256SUMS-$stamp") || fail "checksums do not match"

log "decrypting"
age -d -i "$BACKUP_AGE_IDENTITY" -o "$tmp/zenoeats.dump" "$tmp/enc/zenoeats-$stamp.dump.age"
mkdir -p "$tmp/restored"
age -d -i "$BACKUP_AGE_IDENTITY" "$tmp/enc/images-$stamp.tar.age" | tar -C "$tmp/restored" -xf -

log "starting a scratch PostgreSQL 16"
docker rm -f "$container" > /dev/null 2>&1 || true
# The roles script runs with its development passwords: this database is
# thrown away, and it never listens on anything but its own container.
# Copied in rather than bind-mounted, so the drill works against any Docker
# daemon, including one that cannot see this machine's files.
docker create --name "$container" --network none \
  -e POSTGRES_DB=zenoeats -e POSTGRES_PASSWORD=drill \
  postgres:16-alpine > /dev/null
docker cp "$REPO/infra/postgres/01-roles.sql" "$container:/docker-entrypoint-initdb.d/01-roles.sql"
docker start "$container" > /dev/null
# The image restarts the server once after running init scripts; wait for
# the roles to exist, not merely for the first "ready".
for _ in $(seq 1 60); do
  if docker exec "$container" psql -U postgres -d zenoeats -Atc \
      "select 1 from pg_roles where rolname = 'zenoeats_app'" 2> /dev/null | grep -q 1 \
     && docker exec "$container" pg_isready -U postgres -d zenoeats > /dev/null 2>&1; then
    break
  fi
  sleep 2
done
sleep 3
docker exec "$container" pg_isready -U postgres -d zenoeats > /dev/null || fail "scratch database did not start"

log "restoring"
restore_started=$(date +%s)
docker exec -i "$container" pg_restore -U postgres -d zenoeats --exit-on-error < "$tmp/zenoeats.dump" \
  || fail "pg_restore reported an error"
restore_seconds=$(( $(date +%s) - restore_started ))

q() { docker exec "$container" psql -U postgres -d zenoeats -Atc "$1"; }

log "checking"
restaurants=$(q "select count(*) from restaurants where deleted_at is null")
orders=$(q "select count(*) from orders")
latest=$(q "select coalesce(max(created_at)::text, 'none') from orders")
# Every table with a restaurant_id column is tenant data and must keep its
# policy. A restore that dropped RLS would pass every other check here.
unprotected=$(q "select string_agg(c.relname, ', ') from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join information_schema.columns col on col.table_schema = 'public'
    and col.table_name = c.relname and col.column_name = 'restaurant_id'
  where c.relkind = 'r' and not c.relrowsecurity")
[[ -z "$unprotected" ]] || fail "row-level security is off on: $unprotected"

# Every image a row refers to, from every column that holds one.
q "select image_path from combos union select image_path from item_types
   union select image_path from menu_items union select image_path from modifier_options
   union select brand_name_image_path from restaurants union select logo_path from restaurants
   union select image_path from storefront_banners union select image_path from storefront_shortcuts" \
  | grep -v '^$' > "$tmp/keys" || true
referenced=$(wc -l < "$tmp/keys")
missing=0
while IFS= read -r key; do
  [[ -f "$tmp/restored/images/$key" ]] || { echo "  missing image: $key" >&2; missing=$((missing + 1)); }
done < "$tmp/keys"
[[ $missing -eq 0 ]] || fail "$missing of $referenced referenced images are not in the archive"

total_seconds=$(( $(date +%s) - started ))
cat <<EOF

Restore drill passed for backup $stamp
  restaurants        $restaurants
  orders             $orders (newest $latest)
  images referenced  $referenced, all present
  row-level security on for every tenant table
  pg_restore took    ${restore_seconds}s; whole drill ${total_seconds}s
EOF
if [[ $keep -eq 1 ]]; then
  echo "  scratch database left running: docker exec -it $container psql -U postgres -d zenoeats"
fi
