import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createDatabase, runMigrations, runSeeds } from '../../db/src/index';
import type { CanonicalItem, Store, StoreProductCandidate } from '../../domain/src/index';
import { createComparisonEngine } from './index';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://kauppalista:kauppalista@localhost:51110/kauppalista';
const schema = `test_phase9_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
const db = createDatabase({ connectionString: databaseUrl, schema });
const previousSearchDelay = process.env.PRODUCT_SEARCH_DELAY_MS;

beforeAll(async () => {
  process.env.PRODUCT_SEARCH_DELAY_MS = '0';
  await runMigrations({ connectionString: databaseUrl, schema });
  await runSeeds({ connectionString: databaseUrl, schema });
});

afterAll(async () => {
  await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await db.close();
  if (previousSearchDelay === undefined) {
    delete process.env.PRODUCT_SEARCH_DELAY_MS;
  } else {
    process.env.PRODUCT_SEARCH_DELAY_MS = previousSearchDelay;
  }
});

function makeCandidate(
  source: 'k-ruoka' | 's-kaupat',
  storeId: string,
  productId: string,
  name: string,
  price: number,
  overrides: Partial<StoreProductCandidate> = {},
): StoreProductCandidate {
  return {
    source,
    storeId,
    productId,
    key: overrides.key ?? `${source}|${productId}`,
    ean: overrides.ean ?? null,
    name,
    brand: overrides.brand ?? null,
    size: overrides.size ?? null,
    unit: overrides.unit ?? null,
    price,
    comparisonPrice: overrides.comparisonPrice ?? null,
    searchScore: overrides.searchScore ?? 100,
    searchScoreBreakdown: overrides.searchScoreBreakdown,
    rawPayload: overrides.rawPayload ?? { fixture: true, productId },
  };
}

describe('phase 9 comparison engine', () => {
  test('runs a small shopping list end-to-end, persists rows/logs, and computes totals', async () => {
    const selectedKStore: Store = {
      source: 'k-ruoka',
      storeId: '11111111-1111-1111-1111-111111111111',
      storeName: 'K-Supermarket Keskusta',
      city: 'Tampere',
      address: 'Hämeenkatu 10',
    };
    const selectedSStore: Store = {
      source: 's-kaupat',
      storeId: '22222222-2222-2222-2222-222222222222',
      storeName: 'Prisma Koivistonkylä',
      city: 'Tampere',
      address: 'Koivistontie 1',
    };

    const shoppingList: CanonicalItem[] = [
      {
        id: 'item-milk-1l',
        name: 'Kevytmaito',
        brand: 'Valio',
        manufacturer: 'Valio',
        size: 1,
        unit: 'l',
        category: 'milk',
        synonyms: [],
        aliases: [],
      },
      {
        id: 'item-banana-1kg',
        name: 'Banaani',
        brand: null,
        manufacturer: null,
        size: 1,
        unit: 'kg',
        category: 'fruit',
        synonyms: [],
        aliases: [],
      },
    ];

    const kCandidates: Record<string, StoreProductCandidate[]> = {
      'Valio Kevytmaito 1 l': [
        makeCandidate('k-ruoka', selectedKStore.storeId, 'k-milk-1', 'Valio kevytmaito 1 l', 1.59, {
          brand: 'Valio',
          size: 1,
          unit: 'l',
          ean: '6408430001111',
          searchScore: 97,
        }),
      ],
      'Banaani 1 kg': [
        makeCandidate('k-ruoka', selectedKStore.storeId, 'k-banana-1', 'Banaani 1 kg', 1.99, {
          size: 1,
          unit: 'kg',
          searchScore: 96,
        }),
      ],
    };

    const sCandidates: Record<string, StoreProductCandidate[]> = {
      'Valio Kevytmaito 1 l': [
        makeCandidate('s-kaupat', selectedSStore.storeId, 's-milk-1', 'Valio kevytmaito 1 l', 1.49, {
          brand: 'Valio',
          size: 1,
          unit: 'l',
          ean: '6408430001111',
          searchScore: 95,
        }),
      ],
      'Banaani 1 kg': [
        makeCandidate('s-kaupat', selectedSStore.storeId, 's-banana-1', 'Banaani 1 kg', 1.89, {
          size: 1,
          unit: 'kg',
          searchScore: 94,
        }),
      ],
    };

    const engine = createComparisonEngine({
      db,
      now: () => new Date('2026-05-07T09:00:00.000Z'),
      createRunId: () => 'phase9-run-1',
      kSearcher: {
        source: 'k-ruoka',
        async searchProducts(request) {
          return {
            source: 'k-ruoka',
            storeId: request.storeId,
            query: request.query,
            candidates: kCandidates[request.query] ?? [],
            rawResponse: { query: request.query, ids: (kCandidates[request.query] ?? []).map((c) => c.productId) },
          };
        },
      },
      sSearcher: {
        source: 's-kaupat',
        async searchProducts(request) {
          return {
            source: 's-kaupat',
            storeId: request.storeId,
            query: request.query,
            candidates: sCandidates[request.query] ?? [],
            rawResponse: { query: request.query, ids: (sCandidates[request.query] ?? []).map((c) => c.productId) },
          };
        },
      },
    });

    const result = await engine.runComparison({ selectedKStore, selectedSStore, shoppingList });

    expect(result.comparisonRun.id).toBe('phase9-run-1');
    expect(result.comparisonRun.matchedRows).toHaveLength(2);
    expect(result.comparisonRun.totals).toEqual({
      kTotal: 3.58,
      sTotal: 3.38,
      difference: 0.2,
      matchedItems: 2,
      ambiguousItems: 0,
      missingItems: 0,
    });

    const persisted = await db.getComparisonRunWithItems('phase9-run-1');
    expect(persisted?.items).toHaveLength(2);
    expect(persisted?.logs).toHaveLength(4);
    expect(persisted?.totals).toMatchObject({ kTotal: 3.58, sTotal: 3.38 });
  });

  test('persists the strongest cross-store pair while marking unresolved status', async () => {
    const selectedKStore: Store = {
      source: 'k-ruoka',
      storeId: '11111111-1111-1111-1111-111111111111',
      storeName: 'K-Supermarket Keskusta',
      city: 'Tampere',
      address: 'Hämeenkatu 10',
    };
    const selectedSStore: Store = {
      source: 's-kaupat',
      storeId: '22222222-2222-2222-2222-222222222222',
      storeName: 'Prisma Koivistonkylä',
      city: 'Tampere',
      address: 'Koivistontie 1',
    };

    const shoppingList: CanonicalItem[] = [
      {
        id: 'item-yogurt',
        name: 'Jogurtti',
        brand: 'Valio',
        manufacturer: 'Valio',
        size: 200,
        unit: 'g',
        category: 'dairy',
        synonyms: [],
        aliases: [],
      },
      {
        id: 'item-chicken',
        name: 'Kanafilee',
        brand: 'Atria',
        manufacturer: 'Atria',
        size: 400,
        unit: 'g',
        category: 'meat',
        synonyms: [],
        aliases: [],
      },
    ];

    const engine = createComparisonEngine({
      db,
      now: () => new Date('2026-05-07T10:00:00.000Z'),
      createRunId: () => 'phase9-run-2',
      kSearcher: {
        source: 'k-ruoka',
        async searchProducts(request) {
          if (request.query === 'Valio Jogurtti 200 g') {
            return {
              source: 'k-ruoka',
              storeId: request.storeId,
              query: request.query,
              candidates: [
                makeCandidate('k-ruoka', request.storeId, 'k-yogurt-1', 'Valio jogurtti mansikka 200 g', 1.59, {
                  brand: 'Valio',
                  size: 200,
                  unit: 'g',
                  searchScore: 100,
                }),
              ],
              rawResponse: { ids: ['k-yogurt-1'] },
            };
          }

          return {
            source: 'k-ruoka',
            storeId: request.storeId,
            query: request.query,
            candidates: [
              makeCandidate('k-ruoka', request.storeId, 'k-chicken-1', 'Atria kanafilee 400 g', 4.99, {
                brand: 'Atria',
                size: 400,
                unit: 'g',
                searchScore: 100,
              }),
            ],
            rawResponse: { ids: ['k-chicken-1'] },
          };
        },
      },
      sSearcher: {
        source: 's-kaupat',
        async searchProducts(request) {
          if (request.query === 'Valio Jogurtti 200 g') {
            return {
              source: 's-kaupat',
              storeId: request.storeId,
              query: request.query,
              candidates: [
                makeCandidate('s-kaupat', request.storeId, 's-yogurt-1', 'Valio jogurtti persikka 200 g', 1.55, {
                  brand: 'Valio',
                  size: 200,
                  unit: 'g',
                  searchScore: 100,
                }),
              ],
              rawResponse: { ids: ['s-yogurt-1'] },
            };
          }

          return {
            source: 's-kaupat',
            storeId: request.storeId,
            query: request.query,
            candidates: [
              makeCandidate('s-kaupat', request.storeId, 's-chicken-1', 'Atria kanafilee 500 g', 5.49, {
                brand: 'Atria',
                size: 500,
                unit: 'g',
                searchScore: 100,
              }),
            ],
            rawResponse: { ids: ['s-chicken-1'] },
          };
        },
      },
    });

    const result = await engine.runComparison({ selectedKStore, selectedSStore, shoppingList });

    expect(result.comparisonRun.matchedRows.map((row) => row.status)).toEqual(['ambiguous', 'mismatch']);
    expect(result.comparisonRun.matchedRows[0]?.kMatch?.storeProductId).toBe('k-yogurt-1');
    expect(result.comparisonRun.matchedRows[0]?.sMatch?.storeProductId).toBe('s-yogurt-1');
    expect(result.comparisonRun.matchedRows[1]?.kMatch?.storeProductId).toBe('k-chicken-1');
    expect(result.comparisonRun.matchedRows[1]?.sMatch?.storeProductId).toBe('s-chicken-1');
    expect(result.comparisonRun.totals).toEqual({
      kTotal: 6.58,
      sTotal: 7.04,
      difference: -0.46,
      matchedItems: 0,
      ambiguousItems: 1,
      missingItems: 1,
    });

    const persisted = await db.getComparisonRunWithItems('phase9-run-2');
    expect(persisted?.items).toHaveLength(2);
    expect(persisted?.items[0]?.kMatchId).toBeTruthy();
    expect(persisted?.items[0]?.sMatchId).toBeTruthy();
    expect(persisted?.items[1]?.kMatchId).toBeTruthy();
    expect(persisted?.items[1]?.sMatchId).toBeTruthy();
  });

  test('selects the strongest cross-store pair instead of raw top-1 results', async () => {
    const selectedKStore: Store = {
      source: 'k-ruoka',
      storeId: '11111111-1111-1111-1111-111111111111',
      storeName: 'K-Supermarket Keskusta',
      city: 'Tampere',
      address: 'Hämeenkatu 10',
    };
    const selectedSStore: Store = {
      source: 's-kaupat',
      storeId: '22222222-2222-2222-2222-222222222222',
      storeName: 'Prisma Koivistonkylä',
      city: 'Tampere',
      address: 'Koivistontie 1',
    };

    const shoppingList: CanonicalItem[] = [
      {
        id: 'item-milk-1l-best-pair',
        name: 'Kevytmaito',
        brand: 'Valio',
        manufacturer: 'Valio',
        size: 1,
        unit: 'l',
        category: 'milk',
        synonyms: [],
        aliases: [],
      },
    ];

    const engine = createComparisonEngine({
      db,
      now: () => new Date('2026-05-07T11:00:00.000Z'),
      createRunId: () => 'phase9-run-3',
      kSearcher: {
        source: 'k-ruoka',
        async searchProducts(request) {
          return {
            source: 'k-ruoka',
            storeId: request.storeId,
            query: request.query,
            candidates: [
              makeCandidate('k-ruoka', request.storeId, 'k-top-1', 'Valio vapaan lehmän kevytmaito 1 l', 1.28, {
                brand: 'Valio',
                size: 1,
                unit: 'l',
                searchScore: 100,
              }),
              makeCandidate('k-ruoka', request.storeId, 'k-best-pair', 'Valio kevytmaito 1 l', 1.59, {
                brand: 'Valio',
                size: 1,
                unit: 'l',
                ean: '6408430001111',
                searchScore: 98,
              }),
            ],
            rawResponse: { ids: ['k-top-1', 'k-best-pair'] },
          };
        },
      },
      sSearcher: {
        source: 's-kaupat',
        async searchProducts(request) {
          return {
            source: 's-kaupat',
            storeId: request.storeId,
            query: request.query,
            candidates: [
              makeCandidate('s-kaupat', request.storeId, 's-top-1', 'Valio Luomu kevytmaito 1 l', 1.09, {
                brand: 'Valio',
                size: 1,
                unit: 'l',
                searchScore: 100,
              }),
              makeCandidate('s-kaupat', request.storeId, 's-best-pair', 'Valio kevytmaito 1 l', 1.49, {
                brand: 'Valio',
                size: 1,
                unit: 'l',
                ean: '6408430001111',
                searchScore: 97,
              }),
            ],
            rawResponse: { ids: ['s-top-1', 's-best-pair'] },
          };
        },
      },
    });

    const result = await engine.runComparison({ selectedKStore, selectedSStore, shoppingList });
    const row = result.comparisonRun.matchedRows[0];

    expect(row?.status).toBe('matched');
    expect(row?.kMatch?.storeProductId).toBe('k-best-pair');
    expect(row?.sMatch?.storeProductId).toBe('s-best-pair');
    expect(result.comparisonRun.totals).toEqual({
      kTotal: 1.59,
      sTotal: 1.49,
      difference: 0.1,
      matchedItems: 1,
      ambiguousItems: 0,
      missingItems: 0,
    });
  });

  test('aborts a product search that does not settle', async () => {
    const previousTimeout = process.env.PRODUCT_SEARCH_TIMEOUT_MS;
    process.env.PRODUCT_SEARCH_TIMEOUT_MS = '20';

    const selectedKStore: Store = {
      source: 'k-ruoka',
      storeId: '11111111-1111-1111-1111-111111111111',
      storeName: 'K-Supermarket Keskusta',
      city: 'Tampere',
      address: 'Hameenkatu 10',
    };
    const selectedSStore: Store = {
      source: 's-kaupat',
      storeId: '22222222-2222-2222-2222-222222222222',
      storeName: 'Prisma Koivistonkylä',
      city: 'Tampere',
      address: 'Koivistontie 1',
    };
    const shoppingList: CanonicalItem[] = [
      {
        id: 'item-timeout',
        name: 'Karjalanpiirakka',
        brand: null,
        manufacturer: null,
        size: null,
        unit: null,
        category: null,
        synonyms: [],
        aliases: [],
      },
    ];

    let receivedSignal: AbortSignal | undefined;
    const engine = createComparisonEngine({
      db,
      now: () => new Date('2026-05-07T11:00:00.000Z'),
      createRunId: () => 'phase9-run-timeout',
      kSearcher: {
        source: 'k-ruoka',
        async searchProducts(request) {
          receivedSignal = request.signal;
          return new Promise(() => {});
        },
      },
      sSearcher: {
        source: 's-kaupat',
        async searchProducts(request) {
          return {
            source: 's-kaupat',
            storeId: request.storeId,
            query: request.query,
            candidates: [],
            rawResponse: { fixture: true },
          };
        },
      },
    });

    try {
      await expect(engine.runComparison({ selectedKStore, selectedSStore, shoppingList })).rejects.toThrow(
        /k-ruoka product search timed out/,
      );
      expect(receivedSignal?.aborted).toBe(true);
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.PRODUCT_SEARCH_TIMEOUT_MS;
      } else {
        process.env.PRODUCT_SEARCH_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  test('waits between product search batches while keeping stores in the same batch parallel', async () => {
    const previousDelay = process.env.PRODUCT_SEARCH_DELAY_MS;
    process.env.PRODUCT_SEARCH_DELAY_MS = '30';

    const selectedKStore: Store = {
      source: 'k-ruoka',
      storeId: '11111111-1111-1111-1111-111111111111',
      storeName: 'K-Supermarket Keskusta',
      city: 'Tampere',
      address: 'Hameenkatu 10',
    };
    const selectedSStore: Store = {
      source: 's-kaupat',
      storeId: '22222222-2222-2222-2222-222222222222',
      storeName: 'Prisma Koivistonkylä',
      city: 'Tampere',
      address: 'Koivistontie 1',
    };
    const shoppingList: CanonicalItem[] = [
      {
        id: 'item-delay-1',
        name: 'Maito',
        brand: null,
        manufacturer: null,
        size: null,
        unit: null,
        category: null,
        synonyms: [],
        aliases: [],
      },
      {
        id: 'item-delay-2',
        name: 'Leipa',
        brand: null,
        manufacturer: null,
        size: null,
        unit: null,
        category: null,
        synonyms: [],
        aliases: [],
      },
    ];
    const starts: Array<{ source: 'k-ruoka' | 's-kaupat'; query: string; at: number }> = [];

    const engine = createComparisonEngine({
      db,
      now: () => new Date('2026-05-07T11:00:00.000Z'),
      createRunId: () => 'phase9-run-delay',
      kSearcher: {
        source: 'k-ruoka',
        async searchProducts(request) {
          starts.push({ source: 'k-ruoka', query: request.query, at: performance.now() });
          return {
            source: 'k-ruoka',
            storeId: request.storeId,
            query: request.query,
            candidates: [],
            rawResponse: { fixture: true },
          };
        },
      },
      sSearcher: {
        source: 's-kaupat',
        async searchProducts(request) {
          starts.push({ source: 's-kaupat', query: request.query, at: performance.now() });
          return {
            source: 's-kaupat',
            storeId: request.storeId,
            query: request.query,
            candidates: [],
            rawResponse: { fixture: true },
          };
        },
      },
    });

    try {
      await engine.runComparison({ selectedKStore, selectedSStore, shoppingList });

      const firstBatch = starts.filter((entry) => entry.query === 'Maito');
      const secondBatch = starts.filter((entry) => entry.query === 'Leipa');
      expect(firstBatch).toHaveLength(2);
      expect(secondBatch).toHaveLength(2);
      expect(Math.abs(firstBatch[0]!.at - firstBatch[1]!.at)).toBeLessThan(15);
      expect(Math.min(...secondBatch.map((entry) => entry.at)) - Math.max(...firstBatch.map((entry) => entry.at))).toBeGreaterThanOrEqual(25);
    } finally {
      if (previousDelay === undefined) {
        delete process.env.PRODUCT_SEARCH_DELAY_MS;
      } else {
        process.env.PRODUCT_SEARCH_DELAY_MS = previousDelay;
      }
    }
  });
});
