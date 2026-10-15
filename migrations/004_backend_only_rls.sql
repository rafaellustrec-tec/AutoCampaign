-- The app authenticates in Next.js and connects as the table owner. No browser
-- role is allowed to read agency data through Supabase REST/GraphQL directly.
-- No policies are installed: non-owner roles are denied by default.
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'users','sessions','login_attempts','clients','client_members','oauth_states',
    'connections','ad_accounts','assets','campaigns','campaign_versions','approvals',
    'jobs','external_objects','daily_metrics','audit_log','provider_operations',
    'sync_runs','report_snapshots'
  ] LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',current_schema(),name);
  END LOOP;
END $$;
