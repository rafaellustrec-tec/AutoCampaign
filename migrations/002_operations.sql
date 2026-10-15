CREATE TABLE provider_operations (
 campaign_id uuid NOT NULL REFERENCES campaigns(id), version integer NOT NULL, account_id uuid NOT NULL REFERENCES ad_accounts(id),
 operation_key text NOT NULL, state text NOT NULL CHECK(state IN ('in_flight','succeeded','ambiguous')), result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(campaign_id,version,account_id,operation_key)
);
CREATE TABLE sync_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES ad_accounts(id), started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, status text NOT NULL DEFAULT 'running', error text);
