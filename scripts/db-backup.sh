#!/usr/bin/env bash
# Backs up a CommitMates database into one gzip file that psql restores into a fresh Supabase
# project (docs/runbooks/backup-restore.md). It follows Supabase's own procedure: the Supabase CLI
# runs pg_dump in Docker for the schema and the data, so no local PostgreSQL client is needed.
# Roles are left out: the app defines none of its own, and a new project already has Supabase's.
# The dump writes grants but never revokes, so the source's exact access rights are appended last
# (scripts/db-privileges.ts); otherwise a new project's defaults would reopen what we revoked.
#
# Usage: pnpm db:backup [database-url]
# The URL comes from the argument, else BACKUP_DATABASE_URL, else DIRECT_DATABASE_URL (environment
# or .env.local). Use a direct or session connection, not the transaction pooler.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

url="${1:-${BACKUP_DATABASE_URL:-${DIRECT_DATABASE_URL:-}}}"
if [ -z "$url" ] && [ -f "$root/.env.local" ]; then
  url="$(grep -E '^DIRECT_DATABASE_URL=' "$root/.env.local" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
fi
if [ -z "$url" ]; then
  echo "No database URL: pass one, or set BACKUP_DATABASE_URL or DIRECT_DATABASE_URL." >&2
  exit 1
fi

supabase="$root/node_modules/.bin/supabase"
if [ ! -x "$supabase" ]; then
  echo "The Supabase CLI is missing; run pnpm install first." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "Dumping the schema, the data and the access rights (the URL is not printed)..."
"$supabase" db dump --db-url "$url" -f "$work/schema.sql"
"$supabase" db dump --db-url "$url" --data-only --use-copy -f "$work/data.sql"
"$root/node_modules/.bin/tsx" "$root/scripts/db-privileges.ts" "$url" > "$work/privileges.sql"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$root/backups"
out="$root/backups/$stamp.sql.gz"
# Data is loaded with triggers and foreign-key checks off, as Supabase's restore guide does: rows
# arrive table by table, not in dependency order.
{
  cat "$work/schema.sql"
  echo "SET session_replication_role = replica;"
  cat "$work/data.sql"
  echo "SET session_replication_role = DEFAULT;"
  cat "$work/privileges.sql"
} | gzip -9 > "$out"

echo "Backup written to backups/$stamp.sql.gz ($(du -h "$out" | cut -f1))."
echo "Keep it somewhere other than this machine and the database itself; it holds members' personal data."
