-- New grants bind to workspace authority; old wallet-only grants fail closed.
ALTER TABLE app_mcp_grants ADD COLUMN IF NOT EXISTS business_id TEXT;
ALTER TABLE app_mcp_grants ADD COLUMN IF NOT EXISTS approved_by TEXT;
UPDATE app_mcp_grants SET revoked_at = COALESCE(revoked_at, (extract(epoch FROM clock_timestamp()) * 1000)::bigint)
 WHERE business_id IS NULL OR approved_by IS NULL;
-- Deleting a membership permanently removes its grants' authority, even if that person rejoins.
ALTER TABLE app_mcp_grants DROP CONSTRAINT IF EXISTS app_mcp_grants_membership;
ALTER TABLE app_mcp_grants ADD CONSTRAINT app_mcp_grants_membership FOREIGN KEY (business_id, approved_by)
 REFERENCES wf_memberships(business_id, principal_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS app_mcp_grants_authority ON app_mcp_grants(business_id, approved_by);
