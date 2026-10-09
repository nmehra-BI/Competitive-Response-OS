#!/usr/bin/env bash
# Start the local PostgreSQL 16 cluster and create the Growth OS database and roles.
# Idempotent. Dev only: the passwords below are local development values.
set -euo pipefail

if command -v pg_ctlcluster >/dev/null 2>&1; then
  if ! pg_lsclusters 2>/dev/null | awk '$1=="16" && $2=="main" {print $4}' | grep -q online; then
    pg_ctlcluster 16 main start
  fi
fi

# Run SQL from stdin as the postgres superuser against database $1.
# Uses peer auth when we are root in the container, otherwise TCP as user postgres.
pg_super() {
  local db=$1
  if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
    su postgres -c "psql -v ON_ERROR_STOP=1 -q -X -d $db"
  else
    psql -v ON_ERROR_STOP=1 -q -X -h localhost -U postgres -d "$db"
  fi
}

pg_super postgres <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'me_owner') THEN
    CREATE ROLE me_owner LOGIN PASSWORD 'me_owner_dev' NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'me_app') THEN
    CREATE ROLE me_app LOGIN PASSWORD 'me_app_dev' NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'me_worker') THEN
    CREATE ROLE me_worker LOGIN PASSWORD 'me_worker_dev' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
SELECT 'CREATE DATABASE growth_os OWNER me_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'growth_os')\gexec
SQL

pg_super growth_os <<'SQL'
GRANT CONNECT ON DATABASE growth_os TO me_app, me_worker;
-- pgcrypto supplies digest() for hash checks inside SQL. Created once by the superuser.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL

echo "PostgreSQL ready: database growth_os, roles me_owner / me_app / me_worker"
