-- The deployment administrator provisions the dedicated, non-bypass auth role.
-- It gets no privileges on Bible or user-owned learning tables.
GRANT USAGE ON SCHEMA public TO mathaino_auth;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON users, auth_accounts, auth_sessions,
  auth_verifications, auth_rate_limits TO mathaino_auth;
--> statement-breakpoint
ALTER TABLE auth_verifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth_rate_limits FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TRIGGER auth_verifications_touch_updated_at BEFORE UPDATE ON auth_verifications
FOR EACH ROW EXECUTE FUNCTION mathaino_touch_updated_at();
