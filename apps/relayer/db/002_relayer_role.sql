-- FR-REL-10 (batch 037, security M2): the relayer's own Postgres role. Run by the owner after 001_rel.sql. The password
-- is never in a file: the deploy sets it with ALTER ROLE from a generated value and pipes the URL into Vercel.
-- Created by SQL, not the Neon console/API, so it is not a neon_superuser member; the deploy checks that.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcplus_relayer') THEN CREATE ROLE mcplus_relayer LOGIN; END IF;
END $$;
ALTER ROLE mcplus_relayer NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT USAGE ON SCHEMA public TO mcplus_relayer;
GRANT SELECT, INSERT ON rel_sent, rel_lock TO mcplus_relayer;
GRANT UPDATE (fee_wei, reverted) ON rel_sent TO mcplus_relayer; -- settle
GRANT UPDATE (holder, until_ms) ON rel_lock TO mcplus_relayer;  -- acquire, reserve, release
