INSERT INTO stores (id, source, external_id, name, city, address, postal_code)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'k-ruoka', 'k-supermarket-keskusta', 'K-Supermarket Keskusta', 'Tampere', 'Hämeenkatu 10', '33100'),
  ('22222222-2222-2222-2222-222222222222', 's-kaupat', 'prisma-koivistonkylä', 'Prisma Koivistonkylä', 'Tampere', 'Koivistontie 1', '33820')
ON CONFLICT (source, external_id) DO UPDATE
SET name = EXCLUDED.name,
    city = EXCLUDED.city,
    address = EXCLUDED.address,
    postal_code = EXCLUDED.postal_code,
    updated_at = NOW();

INSERT INTO canonical_items (id, name, brand, manufacturer, size, unit, category)
VALUES
  ('item-banana-1kg', 'Banaani', NULL, NULL, 1, 'kg', 'fruit'),
  ('item-milk-1l', 'Kevytmaito', 'Valio', 'Valio', 1, 'l', 'milk')
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    manufacturer = EXCLUDED.manufacturer,
    size = EXCLUDED.size,
    unit = EXCLUDED.unit,
    category = EXCLUDED.category,
    updated_at = NOW();

INSERT INTO canonical_item_aliases (id, canonical_item_id, alias, alias_type)
VALUES
  ('33333333-3333-3333-3333-333333333333', 'item-banana-1kg', 'bananas', 'synonym'),
  ('44444444-4444-4444-4444-444444444444', 'item-milk-1l', 'kevyt maito', 'spacing')
ON CONFLICT (canonical_item_id, alias) DO NOTHING;

INSERT INTO store_product_matches (
  id,
  canonical_item_id,
  store_id,
  store_product_id,
  product_name,
  brand,
  size,
  unit,
  price,
  comparison_price,
  score,
  confidence,
  status,
  raw_payload
)
VALUES
  (
    '55555555-5555-5555-5555-555555555555',
    'item-banana-1kg',
    '11111111-1111-1111-1111-111111111111',
    'k-banana-1',
    'Banaani',
    NULL,
    1,
    'kg',
    1.99,
    1.99,
    98,
    0.98,
    'matched',
    '{"source":"seed"}'::jsonb
  ),
  (
    '66666666-6666-6666-6666-666666666666',
    'item-banana-1kg',
    '22222222-2222-2222-2222-222222222222',
    's-banana-1',
    'Banaani',
    NULL,
    1,
    'kg',
    1.89,
    1.89,
    97,
    0.96,
    'matched',
    '{"source":"seed"}'::jsonb
  )
ON CONFLICT (store_id, store_product_id) DO UPDATE
SET product_name = EXCLUDED.product_name,
    price = EXCLUDED.price,
    comparison_price = EXCLUDED.comparison_price,
    score = EXCLUDED.score,
    confidence = EXCLUDED.confidence,
    status = EXCLUDED.status,
    raw_payload = EXCLUDED.raw_payload,
    updated_at = NOW(),
    last_seen_at = NOW();

INSERT INTO comparison_runs (id, selected_k_store_id, selected_s_store_id, input_shopping_list, totals)
VALUES (
  'seed-run-1',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '[{"id":"item-banana-1kg","name":"Banaani","size":1,"unit":"kg"}]'::jsonb,
  '{"kTotal":1.99,"sTotal":1.89,"difference":0.10,"matchedItems":1,"ambiguousItems":0,"missingItems":0}'::jsonb
)
ON CONFLICT (id) DO UPDATE
SET input_shopping_list = EXCLUDED.input_shopping_list,
    totals = EXCLUDED.totals,
    updated_at = NOW();

INSERT INTO comparison_run_items (
  id,
  comparison_run_id,
  canonical_item_id,
  input_item,
  k_match_id,
  s_match_id,
  status,
  price_difference,
  notes,
  row_order
)
VALUES (
  '77777777-7777-7777-7777-777777777777',
  'seed-run-1',
  'item-banana-1kg',
  '{"id":"item-banana-1kg","name":"Banaani","size":1,"unit":"kg"}'::jsonb,
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666',
  'matched',
  0.10,
  'Seeded comparison row',
  0
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO search_logs (
  id,
  comparison_run_id,
  canonical_item_id,
  source,
  store_id,
  query,
  candidate_count,
  request_payload,
  response_payload
)
VALUES (
  '88888888-8888-8888-8888-888888888888',
  'seed-run-1',
  'item-banana-1kg',
  'k-ruoka',
  '11111111-1111-1111-1111-111111111111',
  'banaani',
  3,
  '{"query":"banaani"}'::jsonb,
  '{"results":[{"productId":"k-banana-1"}]}'::jsonb
)
ON CONFLICT (id) DO NOTHING;
