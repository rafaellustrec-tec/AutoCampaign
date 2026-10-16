-- Agency-wide inventory. Existing client ownership and row-level security stay intact.
ALTER TABLE oauth_states ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE connections ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE ad_accounts ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE ad_accounts ADD COLUMN available boolean NOT NULL DEFAULT true;
ALTER TABLE ad_accounts ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE connections ADD COLUMN import_status text NOT NULL DEFAULT 'pending'
  CHECK (import_status IN ('pending','running','synced','error'));
ALTER TABLE connections ADD COLUMN import_started_at timestamptz;
ALTER TABLE connections ADD COLUMN imported_at timestamptz;
ALTER TABLE connections ADD COLUMN import_error text;
ALTER TABLE connections ADD COLUMN import_token uuid;
CREATE INDEX ad_accounts_client_idx ON ad_accounts(client_id);
CREATE INDEX ad_accounts_connection_idx ON ad_accounts(connection_id);
CREATE INDEX connections_client_idx ON connections(client_id);
