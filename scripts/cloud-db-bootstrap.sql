-- Cloud database bootstrap (Supabase; decisions.md D-163). Run ONCE per database as the `postgres`
-- user (Supabase SQL editor or the Supabase MCP `execute_sql`), after replacing the three password
-- placeholders with strong random values. Never commit the rendered file. Idempotent: re-running it
-- rotates the passwords and re-applies the grants. The role attributes are set at CREATE only: a
-- non-superuser (Supabase `postgres`) may not name SUPERUSER or BYPASSRLS in ALTER ROLE; the check
-- query at the end confirms both are false.
--
-- It mirrors scripts/db-up.sh: three login roles, NOSUPERUSER and NOBYPASSRLS (never-rule 15);
-- me_owner owns the app schemas (migrations), me_app is the API, me_worker runs jobs.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'me_owner') THEN
    CREATE ROLE me_owner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'me_app') THEN
    CREATE ROLE me_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'me_worker') THEN
    CREATE ROLE me_worker LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

ALTER ROLE me_owner WITH LOGIN PASSWORD '__ME_OWNER_PASSWORD__';
ALTER ROLE me_app WITH LOGIN PASSWORD '__ME_APP_PASSWORD__';
ALTER ROLE me_worker WITH LOGIN PASSWORD '__ME_WORKER_PASSWORD__';

-- me_owner creates the schemas platform, me, sim and graphile_worker; the others only connect.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO me_owner', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO me_app, me_worker', current_database());
END $$;

-- Supabase installs pgcrypto in `extensions`. The migrations do not call it (gen_random_uuid and
-- sha256 are built in), but SQL written for local Postgres calls digest() unqualified; keep it
-- resolvable for our roles without touching the migrations.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['me_owner', 'me_app', 'me_worker'] LOOP
    EXECUTE format('ALTER ROLE %I IN DATABASE %I SET search_path = "$user", public, extensions',
                   r, current_database());
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    GRANT USAGE ON SCHEMA extensions TO me_owner, me_app, me_worker;
  END IF;
END $$;

-- The migration runner records applied files in public.schema_migration. Create it here, owned by
-- me_owner, with RLS on and no Data API grants, so me_owner needs no CREATE on `public` and the
-- table is never exposed through Supabase's REST/GraphQL roles.
GRANT me_owner TO postgres;
CREATE TABLE IF NOT EXISTS public.schema_migration (
  name text PRIMARY KEY,
  sha256 char(64) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
-- A new owner needs CREATE on the schema at the moment of the transfer; it is taken back at once.
GRANT CREATE ON SCHEMA public TO me_owner;
ALTER TABLE public.schema_migration OWNER TO me_owner;
REVOKE CREATE ON SCHEMA public FROM me_owner;
ALTER TABLE public.schema_migration ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schema_migration FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.schema_migration FROM %I', r);
    END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO me_owner;

-- Check: roles, flags, and where pgcrypto lives.
SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls,
       has_database_privilege(r.rolname, current_database(), 'CREATE') AS can_create_schema,
       (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
         WHERE e.extname = 'pgcrypto') AS pgcrypto_schema
  FROM pg_roles r WHERE r.rolname IN ('me_owner', 'me_app', 'me_worker') ORDER BY r.rolname;
