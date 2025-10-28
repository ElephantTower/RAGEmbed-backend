#!/bin/bash
set -e

DATA_DIR="/var/lib/postgresql/data"
MARKER_FILE="$DATA_DIR/.dump_restored"

echo "=== PostgreSQL init script ==="

if [ -f "$MARKER_FILE" ]; then
  echo "Dump already restored. Skipping."
  exit 0
fi

if [ ! -f "$DUMP_PATH" ]; then
  echo "ERROR: Dump not found at $DUMP_PATH"
  ls -la /dumps/ 2>/dev/null || echo "No /dumps content"
  exit 1
fi

echo "Restoring database from dump..."

until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do
  echo "Waiting for PostgreSQL and database '$POSTGRES_DB'..."
  sleep 2
done

echo "PostgreSQL ready. Starting pg_restore..."

pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --verbose "$DUMP_PATH"

touch "$MARKER_FILE"
echo "SUCCESS: Database restored from dump into '$POSTGRES_DB'!"