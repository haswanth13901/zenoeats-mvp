-- Three-role model. Rule 18 of the architecture baseline.
--
--   zenoeats_migrate  owns the schema. Alembic only. Never used at runtime.
--   zenoeats_app      request path + tenant-scoped workers. NOBYPASSRLS.
--   zenoeats_system   narrow cross-tenant discovery + platform inboxes.
--
-- None of these has BYPASSRLS. The CI privilege gate asserts that.
-- Passwords here are for local development. Production injects them from
-- protected secret files on the VM (section 16.5).

CREATE ROLE zenoeats_migrate LOGIN PASSWORD 'migrate_dev_pw' NOBYPASSRLS;
CREATE ROLE zenoeats_app     LOGIN PASSWORD 'app_dev_pw'     NOBYPASSRLS;
CREATE ROLE zenoeats_system  LOGIN PASSWORD 'system_dev_pw'  NOBYPASSRLS;

GRANT CONNECT ON DATABASE zenoeats TO zenoeats_migrate, zenoeats_app, zenoeats_system;

-- The migrate role owns the schema, so it needs CREATE.
GRANT CREATE, USAGE ON SCHEMA public TO zenoeats_migrate;
GRANT USAGE ON SCHEMA public TO zenoeats_app, zenoeats_system;

-- Nobody else creates objects in public.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
