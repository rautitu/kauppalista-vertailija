import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createDatabase, runMigrations, runSeeds } from './index';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://kauppalista:kauppalista@localhost:51110/kauppalista';
const schema = `test_phase3_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

const db = createDatabase({ connectionString: databaseUrl, schema });

beforeAll(async () => {
  await runMigrations({ connectionString: databaseUrl, schema });
  await runSeeds({ connectionString: databaseUrl, schema });
});

afterAll(async () => {
  await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await db.close();
});

describe('database schema integration', () => {
  test('migrates, seeds, inserts, and reads comparison data', async () => {
    const seededStores = await db.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM stores');
    expect(Number(seededStores.rows[0].total)).toBeGreaterThanOrEqual(2);

    await db.createCanonicalItem({
      id: 'item-oat-milk-1l',
      name: 'Kaurajuoma',
      brand: 'Oatly',
      manufacturer: 'Oatly',
      size: 1,
      unit: 'l',
      category: 'milk-alternative',
      metadata: { source: 'integration-test' },
    });

    await db.addCanonicalItemAlias('item-oat-milk-1l', 'oat milk', 'english');

    const storeIdsResult = await db.query<{ id: string; source: 'k-ruoka' | 's-kaupat' }>(
      'SELECT id, source FROM stores ORDER BY source ASC',
    );
    const kStoreId = storeIdsResult.rows.find((row) => row.source === 'k-ruoka')?.id;
    const sStoreId = storeIdsResult.rows.find((row) => row.source === 's-kaupat')?.id;

    expect(kStoreId).toBeDefined();
    expect(sStoreId).toBeDefined();

    const kMatchId = await db.createStoreProductMatch({
      canonicalItemId: 'item-oat-milk-1l',
      storeId: kStoreId!,
      storeProductId: 'k-oat-1',
      productName: 'Oatly Kaurajuoma 1l',
      brand: 'Oatly',
      size: 1,
      unit: 'l',
      price: 2.59,
      comparisonPrice: 2.59,
      score: 94,
      confidence: 0.94,
      status: 'matched',
      rawPayload: { provider: 'fixture' },
    });

    const sMatchId = await db.createStoreProductMatch({
      canonicalItemId: 'item-oat-milk-1l',
      storeId: sStoreId!,
      storeProductId: 's-oat-1',
      productName: 'Oatly Kaurajuoma 1l',
      brand: 'Oatly',
      size: 1,
      unit: 'l',
      price: 2.49,
      comparisonPrice: 2.49,
      score: 93,
      confidence: 0.93,
      status: 'matched',
      rawPayload: { provider: 'fixture' },
    });

    await db.createComparisonRun({
      id: 'integration-run-1',
      selectedKStoreId: kStoreId!,
      selectedSStoreId: sStoreId!,
      inputShoppingList: [{ id: 'item-oat-milk-1l', name: 'Kaurajuoma', size: 1, unit: 'l' }],
      totals: {
        kTotal: 2.59,
        sTotal: 2.49,
        difference: 0.1,
        matchedItems: 1,
        ambiguousItems: 0,
        missingItems: 0,
      },
    });

    await db.addComparisonRunItem({
      comparisonRunId: 'integration-run-1',
      canonicalItemId: 'item-oat-milk-1l',
      inputItem: { id: 'item-oat-milk-1l', name: 'Kaurajuoma', size: 1, unit: 'l' },
      status: 'matched',
      rowOrder: 0,
      kMatchId,
      sMatchId,
      priceDifference: 0.1,
      notes: 'Integration inserted row',
    });

    await db.createSearchLog({
      comparisonRunId: 'integration-run-1',
      canonicalItemId: 'item-oat-milk-1l',
      source: 'k-ruoka',
      storeId: kStoreId!,
      query: 'kaurajuoma 1l',
      candidateCount: 2,
      requestPayload: { q: 'kaurajuoma 1l' },
      responsePayload: { ids: ['k-oat-1'] },
    });

    const item = await db.getCanonicalItemWithAliases('item-oat-milk-1l');
    expect(item?.name).toBe('Kaurajuoma');
    expect(item?.aliases.map((alias) => alias.alias)).toContain('oat milk');

    const run = await db.getComparisonRunWithItems('integration-run-1');
    expect(run?.items).toHaveLength(1);
    expect(run?.logs).toHaveLength(1);
    expect(run?.items[0]?.kMatchId).toBe(kMatchId);
    expect(run?.totals).toMatchObject({ sTotal: 2.49, matchedItems: 1 });
  });
});
