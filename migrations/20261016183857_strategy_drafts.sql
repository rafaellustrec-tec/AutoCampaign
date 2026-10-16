CREATE TABLE strategies (
 id uuid PRIMARY KEY,
 client_id uuid NOT NULL REFERENCES clients(id),
 name text NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 step integer NOT NULL DEFAULT 0 CHECK(step BETWEEN 0 AND 4),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','prepared')),
 data jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 review_due_at timestamptz,
 UNIQUE(id,client_id)
);
CREATE INDEX strategies_client_updated_idx ON strategies(client_id,updated_at DESC);
CREATE TABLE strategy_versions (
 strategy_id uuid NOT NULL REFERENCES strategies(id),
 version integer NOT NULL,
 data jsonb NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(strategy_id,version)
);
CREATE TABLE strategy_campaigns (
 strategy_id uuid NOT NULL REFERENCES strategies(id),
 front_id uuid NOT NULL,
 platform text NOT NULL CHECK(platform IN ('meta','google')),
 campaign_id uuid NOT NULL UNIQUE REFERENCES campaigns(id),
 PRIMARY KEY(strategy_id,front_id,platform)
);
ALTER TABLE strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_campaigns ENABLE ROW LEVEL SECURITY;
