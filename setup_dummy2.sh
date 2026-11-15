#!/usr/bin/env bash
set -euo pipefail

DB_NAME="dummy2"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-osdbmspbl}"

if [[ -z "${PGPASSWORD:-}" ]]; then
    read -r -s -p "PostgreSQL password for ${PGUSER}: " PGPASSWORD
    printf '\n'
    export PGPASSWORD
fi

if ! psql -w -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres \
    -v ON_ERROR_STOP=1 -Atqc 'SELECT 1'; then
    printf 'Could not connect as %s to PostgreSQL at %s:%s.\n' "$PGUSER" "$PGHOST" "$PGPORT" >&2
    exit 1
fi

if psql -w -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres \
    -v ON_ERROR_STOP=1 -Atqc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q '^1$'; then
    printf 'Database "%s" already exists. It was not changed. Choose another name or inspect it first.\n' "$DB_NAME" >&2
    exit 1
fi

createdb -w -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --owner="$PGUSER" "$DB_NAME"
psql -w -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 -f "$(dirname "$0")/sql/dummy2.sql"

printf '\nDatabase "%s" is ready. Start the app and choose "%s".\n' "$DB_NAME" "$DB_NAME"
