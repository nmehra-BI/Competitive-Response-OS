-- =============================================================================
-- 0002 · WS1 platform runtime: session resolution, dev login lookup, definer visibility.
-- Additive only (decisions: see docs/market-expansion/build/notes/WS1.md).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SECURITY DEFINER functions run as me_owner. Every platform table has FORCE ROW LEVEL
--    SECURITY, which also applies to the owner, so a definer function saw no rows at all
--    (platform.list_tenant_ids() returned nothing; claim_outbox_batch() claimed nothing).
--    These policies apply ONLY to me_owner. me_app and me_worker are unaffected and stay
--    tenant-isolated. Definer functions still return ids only.
-- -----------------------------------------------------------------------------
CREATE POLICY owner_definer_read ON platform.tenant FOR SELECT TO me_owner USING (true);
CREATE POLICY owner_definer_read ON platform.app_user FOR SELECT TO me_owner USING (true);
CREATE POLICY owner_definer_read ON platform.session FOR SELECT TO me_owner USING (true);
CREATE POLICY owner_definer_read ON platform.outbox_message FOR SELECT TO me_owner USING (true);
CREATE POLICY owner_definer_claim ON platform.outbox_message FOR UPDATE TO me_owner USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 2. Session resolution. The cookie carries a random token; only sha256(token) is stored.
--    The API does not know the tenant before it resolves the session, and platform.session is
--    tenant-isolated, so resolution goes through this function. It returns ids only, and only
--    for a live session (not revoked, not expired).
-- -----------------------------------------------------------------------------
CREATE FUNCTION platform.resolve_session(p_token_hash text)
RETURNS TABLE (session_id uuid, tenant_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = platform, pg_temp AS $$
  SELECT s.id, s.tenant_id, s.user_id
    FROM platform.session s
   WHERE s.token_hash = p_token_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
$$;

-- -----------------------------------------------------------------------------
-- 3. Dev persona login (AUTH_MODE=dev only; the API never registers the route otherwise).
--    Defence in depth: these lookups only ever answer for ILLUSTRATIVE tenants, so a real
--    customer tenant can never be entered through the persona picker, even if misconfigured.
-- -----------------------------------------------------------------------------
CREATE FUNCTION platform.dev_login_tenant(p_user_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = platform, pg_temp AS $$
  SELECT u.tenant_id
    FROM platform.app_user u
    JOIN platform.tenant t ON t.id = u.tenant_id
   WHERE u.id = p_user_id AND u.is_active AND t.illustrative
$$;

CREATE FUNCTION platform.illustrative_tenant_id(p_slug text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = platform, pg_temp AS $$
  SELECT t.id FROM platform.tenant t WHERE t.slug = p_slug AND t.illustrative
$$;

REVOKE EXECUTE ON FUNCTION platform.resolve_session(text), platform.dev_login_tenant(uuid),
  platform.illustrative_tenant_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.resolve_session(text), platform.dev_login_tenant(uuid),
  platform.illustrative_tenant_id(text) TO me_app;

-- -----------------------------------------------------------------------------
-- 4. Indexes for WS1 read paths (idempotency expiry sweep, source freshness, analytics flush).
-- -----------------------------------------------------------------------------
CREATE INDEX idempotency_record_expiry_idx ON platform.idempotency_record (tenant_id, expires_at);
CREATE INDEX analytics_event_unemitted_idx ON platform.analytics_event (tenant_id, occurred_at)
  WHERE emitted_at IS NULL;
CREATE INDEX source_freshness_idx ON platform.source (tenant_id, freshness)
  WHERE deleted_at IS NULL;
