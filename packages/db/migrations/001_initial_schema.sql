CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('k-ruoka', 's-kaupat')),
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  city TEXT,
  address TEXT,
  postal_code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, external_id)
);

CREATE TABLE canonical_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  manufacturer TEXT,
  size NUMERIC(10, 3),
  unit TEXT,
  category TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE canonical_item_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_item_id TEXT NOT NULL REFERENCES canonical_items(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  alias_type TEXT NOT NULL DEFAULT 'search',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (canonical_item_id, alias)
);

CREATE TABLE store_product_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_item_id TEXT NOT NULL REFERENCES canonical_items(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  store_product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  brand TEXT,
  size NUMERIC(10, 3),
  unit TEXT,
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  comparison_price NUMERIC(10, 2) CHECK (comparison_price IS NULL OR comparison_price >= 0),
  score NUMERIC(10, 3) NOT NULL,
  confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL CHECK (status IN ('matched', 'ambiguous', 'not_found')),
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, store_product_id)
);

CREATE TABLE comparison_runs (
  id TEXT PRIMARY KEY,
  selected_k_store_id UUID NOT NULL REFERENCES stores(id),
  selected_s_store_id UUID NOT NULL REFERENCES stores(id),
  input_shopping_list JSONB NOT NULL DEFAULT '[]'::jsonb,
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (selected_k_store_id <> selected_s_store_id)
);

CREATE TABLE comparison_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comparison_run_id TEXT NOT NULL REFERENCES comparison_runs(id) ON DELETE CASCADE,
  canonical_item_id TEXT NOT NULL REFERENCES canonical_items(id),
  input_item JSONB NOT NULL,
  k_match_id UUID REFERENCES store_product_matches(id) ON DELETE SET NULL,
  s_match_id UUID REFERENCES store_product_matches(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('matched', 'ambiguous', 'not_found')),
  price_difference NUMERIC(10, 2),
  notes TEXT,
  row_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE search_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comparison_run_id TEXT REFERENCES comparison_runs(id) ON DELETE SET NULL,
  canonical_item_id TEXT REFERENCES canonical_items(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('k-ruoka', 's-kaupat')),
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  query TEXT NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  request_payload JSONB,
  response_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX stores_source_idx ON stores (source);
CREATE INDEX canonical_item_aliases_alias_idx ON canonical_item_aliases (alias);
CREATE INDEX store_product_matches_canonical_item_idx ON store_product_matches (canonical_item_id);
CREATE INDEX comparison_run_items_run_id_idx ON comparison_run_items (comparison_run_id, row_order);
CREATE INDEX search_logs_run_id_idx ON search_logs (comparison_run_id, created_at DESC);

CREATE TRIGGER stores_set_updated_at
BEFORE UPDATE ON stores
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TRIGGER canonical_items_set_updated_at
BEFORE UPDATE ON canonical_items
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TRIGGER store_product_matches_set_updated_at
BEFORE UPDATE ON store_product_matches
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TRIGGER comparison_runs_set_updated_at
BEFORE UPDATE ON comparison_runs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TRIGGER comparison_run_items_set_updated_at
BEFORE UPDATE ON comparison_run_items
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();
