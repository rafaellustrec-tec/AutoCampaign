CREATE TABLE report_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES clients(id), created_by uuid NOT NULL REFERENCES users(id),
 period_start date NOT NULL, period_end date NOT NULL, config jsonb NOT NULL, data jsonb NOT NULL,
 storage_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
